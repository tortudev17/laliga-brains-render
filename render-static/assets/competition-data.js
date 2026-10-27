(() => {
  const ACTIVE_MISSION = "playing";
  const BET_OPEN = "open";
  const claimLocks = new Map();

  function pathSegment(value, label) {
    const text = String(value ?? "").trim();
    if (!text || /[.#$\[\]\/]/.test(text)) throw new Error(`${label} no válido.`);
    return text;
  }

  function urlFor(baseUrl, idToken, path) {
    const root = String(baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!root) throw new Error("Falta la URL de Firebase.");
    if (!idToken) throw new Error("Inicia sesión para continuar.");
    const encoded = path ? `${path.split("/").map(encodeURIComponent).join("/")}.json` : ".json";
    return `${root}/${encoded}?auth=${encodeURIComponent(idToken)}`;
  }

  async function request(baseUrl, idToken, path, options = {}) {
    let response;
    try {
      response = await fetch(urlFor(baseUrl, idToken, path), {
        method: options.method ?? "GET",
        headers: {
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.headers ?? {})
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        cache: "no-store"
      });
    } catch {
      throw new Error("No se pudo conectar con Firebase. Comprueba la conexión e inténtalo otra vez.");
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof body === "string" ? body : body?.error;
      throw new Error(detail ? `Firebase: ${detail}` : `Firebase devolvió el error ${response.status}.`);
    }
    return { body, response };
  }

  async function read(baseUrl, idToken, path) {
    return (await request(baseUrl, idToken, path)).body;
  }

  function numeric(value, fallback = 0) {
    if (value === null || value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function dateNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    const raw = String(value ?? "").trim();
    if (/^\d{10,13}$/.test(raw)) return raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizePlayer(value) {
    return String(value ?? "").replace(/^\$+/, "").trim();
  }

  function scorerCount(match, playerId) {
    const target = String(playerId ?? "").toLocaleLowerCase("es-ES");
    const entries = Array.isArray(match?.scorerEntries) ? match.scorerEntries : [];
    const entry = entries.find((scorer) => {
      const name = normalizePlayer(scorer?.name ?? scorer?.scorer ?? scorer?.player);
      return name.toLocaleLowerCase("es-ES") === target;
    });
    return entry ? Math.max(0, Math.floor(numeric(entry.goals ?? entry.count, 1))) : 0;
  }

  function allScorers(matches) {
    const players = new Map();
    for (const match of matches) {
      for (const item of Array.isArray(match?.scorerEntries) ? match.scorerEntries : []) {
        const name = normalizePlayer(item?.name ?? item?.scorer ?? item?.player);
        if (!name) continue;
        const key = name.toLocaleLowerCase("es-ES");
        const previous = players.get(key) ?? { id: key.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "-"), name, goals: 0, appearances: 0 };
        const goals = Math.max(0, Math.floor(numeric(item?.goals ?? item?.count, 1)));
        previous.goals += goals;
        previous.appearances += goals > 0 ? 1 : 0;
        players.set(key, previous);
      }
    }
    return [...players.values()].sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "es"));
  }

  function pointFor(match, grade) {
    const direct = match?.points?.[grade];
    if (direct !== undefined && direct !== null) return numeric(direct, null);
    const goals = match?.goals ?? {};
    if (goals["3eso"] === undefined || goals["4eso"] === undefined) return null;
    if (numeric(goals[grade]) > numeric(goals[grade === "3eso" ? "4eso" : "3eso"])) return 3;
    if (numeric(goals[grade]) === numeric(goals[grade === "3eso" ? "4eso" : "3eso"])) return 1;
    return 0;
  }

  function logisticElo(matches) {
    const usable = [...matches].sort((a, b) => numeric(a.sortTime) - numeric(b.sortTime));
    let rating3 = 1500;
    let rating4 = 1500;
    let draws = 0;
    let played = 0;
    for (const match of usable) {
      const p3 = pointFor(match, "3eso");
      const p4 = pointFor(match, "4eso");
      if (p3 === null || p4 === null) continue;
      const expected3 = 1 / (1 + 10 ** ((rating4 - rating3) / 400));
      const outcome3 = p3 > p4 ? 1 : p3 < p4 ? 0 : 0.5;
      if (outcome3 === 0.5) draws += 1;
      rating3 += 24 * (outcome3 - expected3);
      rating4 += 24 * ((1 - outcome3) - (1 - expected3));
      played += 1;
    }

    // Elo supplies the relative win split. A smoothed historical draw rate
    // supplies a separate draw probability; both are normalized together.
    const drawProbability = Math.min(0.4, Math.max(0.12, (draws + 1) / (played + 3)));
    const threeWinShare = 1 / (1 + 10 ** ((rating4 - rating3) / 400));
    return {
      model: "Elo ligero · forma histórica",
      sampleSize: played,
      probabilities: {
        "3eso": Math.round((1 - drawProbability) * threeWinShare * 1000) / 1000,
        draw: Math.round(drawProbability * 1000) / 1000,
        "4eso": Math.round((1 - drawProbability) * (1 - threeWinShare) * 1000) / 1000
      }
    };
  }

  function predictScorers(matches, players = allScorers(matches)) {
    const appearances = matches.length;
    return players.map((player) => {
      const goals = matches.reduce((sum, match) => sum + scorerCount(match, player.name), 0);
      const playerAppearances = matches.reduce((sum, match) => sum + (scorerCount(match, player.name) > 0 ? 1 : 0), 0);
      // Beta(1, 3) smoothing keeps small samples from claiming certainty.
      const probability = (playerAppearances + 1) / (appearances + 4);
      return {
        ...player,
        probability: Math.round(probability * 1000) / 1000,
        model: "Probabilidad suavizada · goleadores históricos",
        sampleSize: appearances,
        goals
      };
    });
  }

  async function loadMatches(baseUrl, idToken) {
    if (window.PartidosData?.loadMatches) return window.PartidosData.loadMatches(baseUrl, idToken);
    const collection = await read(baseUrl, idToken, "scores/global/match");
    if (!collection || typeof collection !== "object") return [];
    const entries = await Promise.all(Object.entries(collection).map(async ([key, match]) => {
      if (!match || typeof match !== "object") return null;
      const id = String(match.id ?? key);
      pathSegment(id, "El identificador del partido");
      const [scorers, p3, p4] = await Promise.all([
        read(baseUrl, idToken, `scores/4eso/match/${id}/scorers`),
        read(baseUrl, idToken, `scores/3eso/match/${id}/points`),
        read(baseUrl, idToken, `scores/4eso/match/${id}/points`)
      ]);
      const scorerEntries = Array.isArray(scorers)
        ? scorers.reduce((list, raw) => {
          const name = normalizePlayer(raw?.name ?? raw);
          if (!name) return list;
          const existing = list.find((item) => item.name.toLocaleLowerCase("es-ES") === name.toLocaleLowerCase("es-ES"));
          if (existing) existing.goals += numeric(raw?.goals ?? raw?.count, 1);
          else list.push({ name, goals: numeric(raw?.goals ?? raw?.count, 1) });
          return list;
        }, [])
        : [];
      return { id, sortTime: dateNumber(match.datePlayed ?? match.date ?? match.timestamp), points: { "3eso": p3, "4eso": p4 }, scorerEntries };
    }));
    return entries.filter(Boolean).sort((a, b) => b.sortTime - a.sortTime);
  }

  function normalizeFixture(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = pathSegment(raw.id, "El identificador del próximo partido");
    return {
      id,
      date: raw.datePlayed ?? raw.date ?? raw.kickoff ?? null,
      teams: raw.teams ?? ["3.º ESO", "4.º ESO"],
      status: raw.status ?? "scheduled"
    };
  }

  async function loadPredictionData(baseUrl, idToken, username) {
    const user = pathSegment(username, "El nombre de usuario");
    const [matches, storedFixture, existingBets] = await Promise.all([
      loadMatches(baseUrl, idToken),
      read(baseUrl, idToken, "scores/global/upcomingMatch"),
      loadBets(baseUrl, idToken, user)
    ]);
    const prediction = logisticElo(matches);
    const scorers = predictScorers(matches);
    const fixture = normalizeFixture(storedFixture) ?? {
      id: `siguiente-${new Date().toISOString().slice(0, 10)}`,
      date: null,
      teams: ["3.º ESO", "4.º ESO"],
      status: "scheduled",
      isSuggested: true
    };
    return { fixture, matches, prediction, scorers, existingBets };
  }

  async function walletSnapshot(baseUrl, idToken, username, preferredPath = "money") {
    const user = pathSegment(username, "El nombre de usuario");
    const candidates = preferredPath === "balance" ? ["balance", "money"] : ["money", "balance"];
    for (const field of candidates) {
      const { body, response } = await request(baseUrl, idToken, `users/${user}/${field}`, {
        headers: { "X-Firebase-ETag": "true" }
      });
      if (body !== null && body !== undefined) {
        const balance = Number(body);
        if (!Number.isFinite(balance) || balance < 0) throw new Error("El saldo de monedas no es válido.");
        return { user, field, balance, etag: response.headers.get("ETag") };
      }
    }
    throw new Error("No se encontró el saldo de monedas de la cuenta.");
  }

  async function changeBalance(baseUrl, idToken, username, delta, { insufficientMessage = "No tienes suficientes monedas." } = {}) {
    if (!Number.isFinite(delta) || delta === 0) throw new Error("La cantidad de monedas no es válida.");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const snapshot = await walletSnapshot(baseUrl, idToken, username);
      const next = snapshot.balance + delta;
      if (next < 0) throw new Error(insufficientMessage);
      if (!snapshot.etag) throw new Error("Firebase no permite comprobar el saldo de forma segura.");
      try {
        await request(baseUrl, idToken, `users/${snapshot.user}/${snapshot.field}`, {
          method: "PUT",
          headers: { "If-Match": snapshot.etag },
          body: next
        });
        return { previous: snapshot.balance, balance: next, field: snapshot.field };
      } catch (error) {
        if (!String(error.message).includes("412") && !String(error.message).includes("ETag")) throw error;
      }
    }
    throw new Error("El saldo cambió a la vez en otra acción. Vuelve a intentarlo.");
  }

  function finitePositiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > max) throw new Error(`${label} debe ser un número entero mayor que cero.`);
    return amount;
  }

  async function submitBet(baseUrl, idToken, username, details) {
    const user = pathSegment(username, "El nombre de usuario");
    const matchId = pathSegment(details?.matchId, "El partido");
    const stake = finitePositiveInteger(details?.stake, "La apuesta", 1000000);
    const type = details?.type;
    let selection;
    let playerName = null;
    if (type === "winner") {
      selection = String(details.selection ?? "");
      if (!["3eso", "draw", "4eso"].includes(selection)) throw new Error("Selecciona 3.º ESO, empate o 4.º ESO.");
    } else if (type === "scorer") {
      playerName = normalizePlayer(details.playerName);
      selection = details.selection === true || details.selection === "yes" ? "yes" : details.selection === false || details.selection === "no" ? "no" : "";
      if (!playerName || !selection) throw new Error("Elige un jugador y si marcará o no.");
    } else {
      throw new Error("El tipo de apuesta no es válido.");
    }

    const id = `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bet = {
      id,
      type,
      matchId,
      selection,
      ...(playerName ? { playerName } : {}),
      stake,
      status: BET_OPEN,
      placedAt: Date.now()
    };

    const wallet = await changeBalance(baseUrl, idToken, user, -stake);
    try {
      await request(baseUrl, idToken, `predictions/${user}/${id}`, { method: "PUT", body: bet });
    } catch (error) {
      try {
        await changeBalance(baseUrl, idToken, user, stake);
      } catch {
        throw new Error("La apuesta no se guardó y el reembolso automático no se pudo completar. Contacta con un administrador.");
      }
      throw error;
    }
    return { bet, balance: wallet.balance };
  }

  async function loadBets(baseUrl, idToken, username) {
    const user = pathSegment(username, "El nombre de usuario");
    const collection = await read(baseUrl, idToken, `predictions/${user}`);
    if (!collection || typeof collection !== "object") return [];
    return Object.entries(collection)
      .filter(([, item]) => item && typeof item === "object")
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => numeric(b.placedAt) - numeric(a.placedAt));
  }

  async function loadAssignments(baseUrl, idToken, username) {
    const user = pathSegment(username, "El nombre de usuario");
    const [collection, team] = await Promise.all([
      read(baseUrl, idToken, `fantasy/assignments/${user}`),
      read(baseUrl, idToken, `fantasy/teams/${user}/players`)
    ]);
    const roster = team && typeof team === "object" ? team : {};
    const missions = collection && typeof collection === "object"
      ? Object.entries(collection).filter(([, item]) => item && typeof item === "object").map(([id, item]) => ({ id, ...item }))
      : [];
    return {
      roster: Object.entries(roster).map(([id, player]) => ({ id, ...player })),
      assignments: missions.sort((a, b) => numeric(b.startedAt) - numeric(a.startedAt))
    };
  }

  function calculateReward(value, durationHours, rate = 0.1) {
    const safeRate = Number(rate);
    if (!Number.isFinite(safeRate) || safeRate < 0 || safeRate > 1) throw new Error("La tasa de recompensa no es válida.");
    return Math.max(1, Math.floor(value * durationHours * safeRate));
  }

  async function startAssignment(baseUrl, idToken, username, playerId, durationHours) {
    const user = pathSegment(username, "El nombre de usuario");
    const playerKey = pathSegment(playerId, "El jugador");
    const hours = Number(durationHours);
    const [team, assignments, settings] = await Promise.all([
      read(baseUrl, idToken, `fantasy/teams/${user}/players`),
      read(baseUrl, idToken, `fantasy/assignments/${user}`),
      read(baseUrl, idToken, "kingdom/settings").catch(() => null)
    ]);
    const minHours = Number(settings?.minHours) || 1;
    const maxHours = Number(settings?.maxHours) || 8;
    if (!Number.isInteger(hours) || hours < minHours || hours > maxHours) throw new Error(`Elige una duración de entre ${minHours} y ${maxHours} horas.`);
    const player = team?.[playerKey];
    if (!player || typeof player !== "object") throw new Error("Solo puedes enviar a jugar a un jugador de tu equipo.");
    const active = Object.values(assignments && typeof assignments === "object" ? assignments : {}).some((item) => (
      item && item.playerId === playerKey && item.status === ACTIVE_MISSION
    ));
    if (active) throw new Error("Este jugador ya está jugando un partido.");
    const value = numeric(player.value, null);
    if (value === null || value <= 0) throw new Error("El valor del jugador no es válido.");
    const startedAt = Date.now();
    const rewardCoins = calculateReward(value, hours, Number(settings?.assignmentRewardRate ?? 0.1));
    const mission = {
      playerId: playerKey,
      playerName: String(player.name ?? playerKey),
      valueAtStart: value,
      durationHours: hours,
      startedAt,
      completesAt: startedAt + hours * 60 * 60 * 1000,
      rewardCoins,
      status: ACTIVE_MISSION
    };
    const created = await request(baseUrl, idToken, `fantasy/assignments/${user}`, { method: "POST", body: mission });
    return { id: created.body?.name ?? null, ...mission };
  }

  async function assignmentSnapshot(baseUrl, idToken, user, missionId) {
    const path = `fantasy/assignments/${user}/${missionId}`;
    const { body, response } = await request(baseUrl, idToken, path, { headers: { "X-Firebase-ETag": "true" } });
    return { path, mission: body, etag: response.headers.get("ETag") };
  }

  async function claimAssignment(baseUrl, idToken, username, missionId) {
    const user = pathSegment(username, "El nombre de usuario");
    const missionKey = pathSegment(missionId, "El partido");
    const snapshot = await assignmentSnapshot(baseUrl, idToken, user, missionKey);
    const mission = snapshot.mission;
    if (!mission || typeof mission !== "object") throw new Error("No se encontró este partido.");
    if (mission.status === "claimed") throw new Error("Las monedas de este partido ya se han cobrado.");
    if (numeric(mission.completesAt) > Date.now()) throw new Error("Tu jugador todavía está jugando. Vuelve cuando termine el tiempo.");
    if (mission.status !== ACTIVE_MISSION && mission.status !== "claiming") throw new Error("Este partido no se puede cobrar.");

    let claimId = claimLocks.get(`${user}/${missionKey}`);
    if (mission.status === ACTIVE_MISSION) {
      if (!snapshot.etag) throw new Error("Firebase no permite proteger el cobro frente a duplicados.");
      claimId = claimId ?? `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const claiming = { ...mission, status: "claiming", claimId };
      try {
        await request(baseUrl, idToken, snapshot.path, {
          method: "PUT",
          headers: { "If-Match": snapshot.etag },
          body: claiming
        });
      } catch {
        throw new Error("Otro cobro ya está en marcha. Actualiza la lista antes de volver a intentarlo.");
      }
      claimLocks.set(`${user}/${missionKey}`, claimId);
    } else if (!claimId || mission.claimId !== claimId) {
      throw new Error("El cobro ya está reservado. Actualiza la lista o inténtalo de nuevo desde esta sesión.");
    }

    const reward = finitePositiveInteger(mission.rewardCoins, "La recompensa", 1000000000);
    let wallet;
    try {
      wallet = await walletSnapshot(baseUrl, idToken, user);
      await request(baseUrl, idToken, "", {
        method: "PATCH",
        body: {
          [`users/${user}/${wallet.field}`]: wallet.balance + reward,
          [`fantasy/assignments/${user}/${missionKey}/status`]: "claimed",
          [`fantasy/assignments/${user}/${missionKey}/claimedAt`]: Date.now(),
          [`fantasy/assignments/${user}/${missionKey}/claimId`]: claimId
        }
      });
    } catch (error) {
      // Keep the claim token locally. A retry in this session rechecks state before
      // retrying the atomic balance + claimed update, preventing double collection.
      throw error;
    }
    claimLocks.delete(`${user}/${missionKey}`);
    return { rewardCoins: reward, balance: wallet.balance + reward, status: "claimed" };
  }

  window.CompetitionData = Object.freeze({
    loadPredictionData,
    predictOutcomes: logisticElo,
    predictScorers,
    listScorers: allScorers,
    submitBet,
    loadBets,
    loadAssignments,
    startAssignment,
    claimAssignment,
    calculateReward
  });
})();
