(() => {
  const gradeIds = ["3eso", "4eso"];
  const metricAliases = {
    goals: ["goles", "goal", "goalCount"],
    currentWinStreak: ["currentwinstreak", "winStreak", "winstreak", "current_win_streak", "streak", "racha"]
  };
  const demoMatches = [
    {
      id: "demo-2026-10-26",
      datePlayed: "2026-10-26T12:00:00.000Z",
      resultingScore: { "3eso": "0 - 0", "4eso": "6 - 5" },
      metrics: { "3eso": { points: 0, goals: 0 }, "4eso": { points: 0, goals: 6 } },
      scorers: ["$fer", "$fer", "$alex", "$victor", "$victor", "$victor"]
    },
    {
      id: "demo-2026-10-19",
      datePlayed: "2026-10-19T12:00:00.000Z",
      resultingScore: { "3eso": "3 - 1", "4eso": "2 - 0" },
      metrics: { "3eso": { points: 3, goals: 3 }, "4eso": { points: 0, goals: 2 } }
    },
    {
      id: "demo-2026-10-12",
      datePlayed: "2026-10-12T12:00:00.000Z",
      resultingScore: { "3eso": "2 - 2", "4eso": "2 - 2" },
      metrics: { "3eso": { points: 1, goals: 2 }, "4eso": { points: 1, goals: 2 } }
    },
    {
      id: "demo-2026-10-05",
      datePlayed: "2026-10-05T12:00:00.000Z",
      resultingScore: { "3eso": "1 - 2", "4eso": "4 - 1" },
      metrics: { "3eso": { points: 0, goals: 1 }, "4eso": { points: 3, goals: 4 } }
    }
  ];

  function makeUrl(baseUrl, path, idToken) {
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("Partidos: falta la URL de Firebase.");
    if (!idToken) throw new Error("Partidos: falta el token de autenticación de Firebase.");
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return `${base}/${encodedPath}.json?auth=${encodeURIComponent(idToken)}`;
  }

  async function readJson(baseUrl, idToken, path) {
    let response;
    try {
      response = await fetch(makeUrl(baseUrl, path, idToken), { cache: "no-store" });
    } catch (error) {
      throw new Error(`Partidos: no se pudo leer /${path}: ${error.message}`);
    }
    if (!response.ok) throw new Error(`Partidos: error ${response.status} al leer /${path}.`);
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`Partidos: respuesta no válida al leer /${path}: ${error.message}`);
    }
  }

  async function writeJson(baseUrl, idToken, path, value) {
    let response;
    try {
      response = await fetch(makeUrl(baseUrl, path, idToken), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value)
      });
    } catch (error) {
      throw new Error(`Partidos: no se pudo inicializar /${path}: ${error.message}`);
    }
    if (!response.ok) throw new Error(`Partidos: error ${response.status} al inicializar /${path}.`);
  }

  async function writeIfMissing(baseUrl, idToken, path, value) {
    const current = await readJson(baseUrl, idToken, path);
    if (current !== null && current !== undefined) return false;
    await writeJson(baseUrl, idToken, path, value);
    return true;
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === "") return 0;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  async function readMetric(baseUrl, idToken, grade, canonical, aliases = []) {
    let value = await readJson(baseUrl, idToken, `scores/${grade}/${canonical}`);
    for (const alias of aliases) {
      if (value !== null && value !== undefined) break;
      value = await readJson(baseUrl, idToken, `scores/${grade}/${alias}`);
    }
    return numberValue(value);
  }

  async function seedAggregateMetricIfMissing(baseUrl, idToken, grade, canonical, aliases = []) {
    const paths = [canonical, ...aliases].map((field) => `scores/${grade}/${field}`);
    const values = await Promise.all(paths.map((path) => readJson(baseUrl, idToken, path)));
    if (values.some((value) => value !== null && value !== undefined)) return;
    await writeIfMissing(baseUrl, idToken, paths[0], 0);
  }

  async function loadGrade(baseUrl, idToken, grade) {
    const pointsPath = `scores/${grade}/points`;
    let points = await readJson(baseUrl, idToken, pointsPath);
    if (points === null) {
      await writeJson(baseUrl, idToken, pointsPath, 0);
      points = 0;
    }

    const [goals, currentWinStreak] = await Promise.all([
      readMetric(baseUrl, idToken, grade, "goals", metricAliases.goals),
      readMetric(baseUrl, idToken, grade, "currentWinStreak", metricAliases.currentWinStreak)
    ]);

    return { points: numberValue(points), goals, currentWinStreak };
  }

  async function loadScores(baseUrl, idToken) {
    const entries = await Promise.all(gradeIds.map(async (grade) => [grade, await loadGrade(baseUrl, idToken, grade)]));
    return Object.fromEntries(entries);
  }

  function safeText(value) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }

  function dateParts(value) {
    if (value === null || value === undefined || value === "") return { sortTime: 0, dateLabel: "" };
    let sortTime;
    if (typeof value === "number" && Number.isFinite(value)) {
      sortTime = Math.abs(value) < 1e12 ? value * 1000 : value;
    } else {
      const text = String(value).trim();
      if (/^\d{10,13}$/.test(text)) {
        const numeric = Number(text);
        sortTime = text.length === 10 ? numeric * 1000 : numeric;
      } else {
        sortTime = Date.parse(text);
      }
    }
    const date = new Date(sortTime);
    if (!Number.isFinite(sortTime) || !Number.isFinite(date.getTime())) {
      return { sortTime: 0, dateLabel: safeText(value) };
    }
    return {
      sortTime,
      dateLabel: new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(date)
    };
  }

  function resultText(value) {
    const direct = safeText(value);
    if (direct) return direct;
    if (!value || typeof value !== "object") return "";
    const gradeScoreText = ["3eso", "4eso"].flatMap((grade) => {
      const key = Object.keys(value).find((candidate) => candidate.toLowerCase() === grade);
      if (!key || value[key] === null || value[key] === undefined) return [];
      const label = grade === "3eso" ? "3.º ESO" : "4.º ESO";
      const score = resultText(value[key]);
      return [score ? `${label}: ${score}` : `${label}: 0`];
    });
    if (gradeScoreText.length) return gradeScoreText.join(" · ");
    const home = value.home ?? value.local ?? value.homeScore ?? value.localScore;
    const away = value.away ?? value.visitor ?? value.awayScore ?? value.visitorScore;
    if (home !== undefined && away !== undefined) return `${home} - ${away}`;
    return safeText(value.text ?? value.label ?? value.score ?? value.points ?? value.value);
  }

  function gradeResults(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const results = {};
    for (const grade of gradeIds) {
      const key = Object.keys(value).find((candidate) => candidate.toLowerCase() === grade);
      if (!key || value[key] === null || value[key] === undefined) continue;
      results[grade] = resultText(value[key]);
    }
    return Object.keys(results).length ? results : null;
  }

  function normalizeScorerName(value) {
    const name = safeText(value).replace(/^\$+/, "").trim();
    if (!name) return "";
    return name.toLocaleLowerCase("es-ES").replace(/(^|[\s'-])(\p{L})/gu, (_, boundary, letter) => (
      boundary + letter.toLocaleUpperCase("es-ES")
    ));
  }

  function scorerCounts(value, players = {}) {
    const counts = new Map();
    const add = (rawName, rawCount = 1, playerId = "", unknown = false) => {
      const id = safeText(playerId);
      const player = id ? players[id] : null;
      const name = unknown ? "No recuerdo" : normalizeScorerName(player?.name ?? rawName);
      if (!name) return;
      const key = unknown ? "unknown" : id ? `player:${id}` : `name:${name.toLocaleLowerCase("es-ES")}`;
      const count = numberValue(rawCount);
      if (count > 0) {
        const current = counts.get(key) || { name, goals: 0, ...(id ? { playerId: id } : {}), ...(unknown ? { unknown: true } : {}) };
        current.goals += Math.floor(count);
        counts.set(key, current);
      }
    };
    const addLegacy = (rawName, rawCount = 1) => {
      const name = normalizeScorerName(rawName);
      if (!name) return;
      const count = numberValue(rawCount);
      add(name, count);
    };
    const visit = (scorers) => {
      if (Array.isArray(scorers)) {
        for (const scorer of scorers) {
          if (typeof scorer === "string" || typeof scorer === "number") addLegacy(scorer);
          else if (scorer && typeof scorer === "object") {
            const name = scorer.name ?? scorer.scorer ?? scorer.player;
            add(name, scorer.goals ?? scorer.count ?? scorer.times ?? 1, scorer.playerId ?? scorer.id, scorer.unknown === true);
          }
        }
        return;
      }
      if (!scorers || typeof scorers !== "object") {
        if (typeof scorers === "string") add(scorers);
        return;
      }
      if (Array.isArray(scorers.scorers)) {
        visit(scorers.scorers);
        return;
      }
      const namedValue = scorers.name ?? scorers.scorer ?? scorers.player;
      if (namedValue !== undefined) {
        add(namedValue, scorers.goals ?? scorers.count ?? scorers.times ?? 1, scorers.playerId ?? scorers.id, scorers.unknown === true);
        return;
      }
      for (const [name, count] of Object.entries(scorers)) {
        if (typeof count === "number" || typeof count === "string") addLegacy(name, count);
        else if (count && typeof count === "object") {
          add(count.name ?? count.scorer ?? name, count.goals ?? count.count ?? count.times ?? 1, count.playerId ?? count.id, count.unknown === true);
        } else if (count === true) addLegacy(name);
      }
    };
    visit(value);
    return [...counts.values()];
  }

  function parseScoreline(value) {
    const text = resultText(value);
    const match = text.match(/^(\d+)\s*[-–:]\s*(\d+)$/);
    return match ? { scored: Number(match[1]), conceded: Number(match[2]) } : { scored: 0, conceded: 0 };
  }

  function pointsFor(score) {
    if (score.scored > score.conceded) return 3;
    if (score.scored === score.conceded) return 1;
    return 0;
  }

  function validPathSegment(value, label) {
    const segment = String(value ?? "").trim();
    if (!segment || /[.#$\[\]\/]/.test(segment)) throw new Error(`Partidos: ${label} no válido.`);
    return segment;
  }

  async function patchJson(baseUrl, idToken, updates) {
    let response;
    try {
      response = await fetch(makeUrl(baseUrl, "", idToken), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
    } catch (error) {
      throw new Error(`Partidos: no se pudo guardar: ${error.message}`);
    }
    if (!response.ok) throw new Error(`Partidos: error ${response.status} al guardar los datos.`);
  }

  async function getNumberOrZero(baseUrl, idToken, path) {
    return numberValue(await readJson(baseUrl, idToken, path));
  }

  async function calculateWinStreak(baseUrl, idToken, grade, changedMatchId, changedPoints, changedDate = null) {
    const [matchCollection, pointsCollection] = await Promise.all([
      readJson(baseUrl, idToken, "scores/global/match"),
      readJson(baseUrl, idToken, `scores/${grade}/match`)
    ]);
    const rows = Object.entries(matchCollection && typeof matchCollection === "object" ? matchCollection : {})
      .filter(([id, match]) => id !== changedMatchId && match && typeof match === "object")
      .map(([id, match]) => ({
        id,
        points: numberValue(pointsCollection?.[id]?.points),
        sortTime: dateParts(match.datePlayed ?? match.playedAt ?? match.date ?? match.datetime ?? match.timestamp).sortTime
      }));
    if (changedPoints !== null) {
      const changedMatch = matchCollection?.[changedMatchId];
      const matchDate = changedDate ?? changedMatch?.datePlayed ?? changedMatch?.playedAt ?? changedMatch?.date ?? changedMatch?.datetime ?? changedMatch?.timestamp;
      rows.push({ id: changedMatchId, points: numberValue(changedPoints), sortTime: dateParts(matchDate).sortTime });
    }
    rows.sort((a, b) => b.sortTime - a.sortTime);
    let streak = 0;
    for (const row of rows) {
      if (row.points !== 3) break;
      streak += 1;
    }
    return streak;
  }

  async function getWalletLocation(baseUrl, idToken, username) {
    const moneyPath = `users/${username}/money`;
    const money = await readJson(baseUrl, idToken, moneyPath);
    if (money !== null && money !== undefined) return { path: moneyPath, balance: numberValue(money) };
    const legacyPath = `users/${username}/balance`;
    const legacy = await readJson(baseUrl, idToken, legacyPath);
    if (legacy !== null && legacy !== undefined) return { path: legacyPath, balance: numberValue(legacy) };
    return { path: moneyPath, balance: 0 };
  }

  function fantasyCoinsPerGoal(player) {
    return Math.max(1, Math.round(numberValue(player.value ?? player.cost) * 0.1));
  }

  function normalizeMatchInput(input) {
    const score = {};
    for (const grade of gradeIds) {
      const row = input?.scores?.[grade];
      const scored = Number(row?.scored);
      const conceded = Number(row?.conceded);
      if (!Number.isSafeInteger(scored) || !Number.isSafeInteger(conceded) || scored < 0 || conceded < 0 || scored > 99 || conceded > 99) {
        throw new Error("Introduce marcadores entre 0 y 99 goles.");
      }
      score[grade] = { scored, conceded };
    }

    const entries = Array.isArray(input?.scorers) ? input.scorers : [];
    const grouped = new Map();
    let sum = 0;
    for (const entry of entries) {
      const goals = Number(entry?.goals ?? 1);
      if (!Number.isSafeInteger(goals) || goals < 1) throw new Error("Cada goleador debe tener al menos un gol.");
      sum += goals;
      if (entry?.unknown === true) {
        const current = grouped.get("unknown") || { name: "No recuerdo", goals: 0, unknown: true };
        current.goals += goals;
        grouped.set("unknown", current);
        continue;
      }
      const playerId = validPathSegment(entry?.playerId, "el jugador");
      const current = grouped.get(playerId) || { playerId, goals: 0 };
      current.goals += goals;
      grouped.set(playerId, current);
    }
    if (sum !== score["4eso"].scored) {
      throw new Error("Indica quién marcó cada gol de 4.º ESO o pulsa «No recuerdo».");
    }

    const date = String(input?.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00.000Z`))) {
      throw new Error("Selecciona una fecha válida para el partido.");
    }
    return {
      datePlayed: `${date}T12:00:00.000Z`,
      result: score,
      scorers: [...grouped.values()]
    };
  }

  async function awardNewFantasyGoals(baseUrl, idToken, matchId, scorerEntries, players, updates) {
    const ledger = await readJson(baseUrl, idToken, `fantasy/matchAwards/${matchId}`).catch(() => null);
    const awards = ledger && typeof ledger === "object" ? ledger : {};
    const playerGoals = new Map(scorerEntries.filter((entry) => entry.playerId && !entry.unknown).map((entry) => [entry.playerId, entry.goals]));
    const walletAdditions = new Map();
    let totalAwarded = 0;

    for (const [playerId, goals] of playerGoals) {
      const player = players[playerId];
      const owner = player?.owner ? validPathSegment(player.owner, "el propietario") : "";
      if (!owner) continue;
      const existing = awards[owner]?.[playerId] && typeof awards[owner][playerId] === "object" ? awards[owner][playerId] : {};
      const alreadyPaidGoals = numberValue(existing.goals);
      const newGoals = Math.max(0, goals - alreadyPaidGoals);
      const perGoal = fantasyCoinsPerGoal(player);
      const reward = newGoals * perGoal;
      const nextGoals = Math.max(alreadyPaidGoals, goals);
      if (reward > 0) {
        walletAdditions.set(owner, (walletAdditions.get(owner) || 0) + reward);
        totalAwarded += reward;
      }
      updates[`fantasy/matchAwards/${matchId}/${owner}/${playerId}`] = {
        goals: nextGoals,
        rewardPerGoal: perGoal,
        totalReward: numberValue(existing.totalReward) + reward,
        playerName: String(player.name ?? playerId),
        updatedAt: Date.now()
      };
    }

    for (const [owner, amount] of walletAdditions) {
      const wallet = await getWalletLocation(baseUrl, idToken, owner);
      updates[wallet.path] = wallet.balance + amount;
    }
    return totalAwarded;
  }

  async function saveMatch(baseUrl, idToken, input, matchId = "") {
    const normalized = normalizeMatchInput(input);
    const id = matchId ? validPathSegment(matchId, "el identificador del partido") : `match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const players = await readJson(baseUrl, idToken, "fantasy/players").catch(() => ({}));
    const previous = await readJson(baseUrl, idToken, `scores/global/match/${id}`).catch(() => null);
    const updates = {
      [`scores/global/match/${id}`]: {
        id,
        datePlayed: normalized.datePlayed,
        resultingScore: Object.fromEntries(gradeIds.map((grade) => [grade, `${normalized.result[grade].scored} - ${normalized.result[grade].conceded}`])),
        isDemo: false
      },
      "scores/global/matchesInitialized": true
    };

    for (const grade of gradeIds) {
      const oldPoints = previous ? await getNumberOrZero(baseUrl, idToken, `scores/${grade}/match/${id}/points`) : 0;
      const oldGoals = previous ? await getNumberOrZero(baseUrl, idToken, `scores/${grade}/match/${id}/goals`) : 0;
      const nextPoints = pointsFor(normalized.result[grade]);
      const nextGoals = normalized.result[grade].scored;
      const totalPoints = await getNumberOrZero(baseUrl, idToken, `scores/${grade}/points`);
      const totalGoals = await readMetric(baseUrl, idToken, grade, "goals", metricAliases.goals);
      updates[`scores/${grade}/match/${id}/points`] = nextPoints;
      updates[`scores/${grade}/match/${id}/goals`] = nextGoals;
      updates[`scores/${grade}/points`] = Math.max(0, totalPoints - oldPoints + nextPoints);
      updates[`scores/${grade}/goals`] = Math.max(0, totalGoals - oldGoals + nextGoals);
      updates[`scores/${grade}/currentWinStreak`] = await calculateWinStreak(baseUrl, idToken, grade, id, nextPoints, normalized.datePlayed);
    }
    updates[`scores/4eso/match/${id}/scorers`] = normalized.scorers.length ? normalized.scorers : null;
    const rewardCoins = await awardNewFantasyGoals(baseUrl, idToken, id, normalized.scorers, players && typeof players === "object" ? players : {}, updates);
    await patchJson(baseUrl, idToken, updates);
    return { id, rewardCoins };
  }

  async function deleteMatch(baseUrl, idToken, matchId) {
    const id = validPathSegment(matchId, "el identificador del partido");
    const existing = await readJson(baseUrl, idToken, `scores/global/match/${id}`);
    if (!existing) throw new Error("No se encontró el partido.");
    const updates = {
      [`scores/global/match/${id}`]: null,
      "scores/global/matchesInitialized": true
    };
    for (const grade of gradeIds) {
      const oldPoints = await getNumberOrZero(baseUrl, idToken, `scores/${grade}/match/${id}/points`);
      const oldGoals = await getNumberOrZero(baseUrl, idToken, `scores/${grade}/match/${id}/goals`);
      const totalPoints = await getNumberOrZero(baseUrl, idToken, `scores/${grade}/points`);
      const totalGoals = await readMetric(baseUrl, idToken, grade, "goals", metricAliases.goals);
      updates[`scores/${grade}/match/${id}`] = null;
      updates[`scores/${grade}/points`] = Math.max(0, totalPoints - oldPoints);
      updates[`scores/${grade}/goals`] = Math.max(0, totalGoals - oldGoals);
      updates[`scores/${grade}/currentWinStreak`] = await calculateWinStreak(baseUrl, idToken, grade, id, null);
    }
    await patchJson(baseUrl, idToken, updates);
    return { id };
  }

  async function saveManualGoals(baseUrl, idToken, playerId, goals) {
    const id = validPathSegment(playerId, "el jugador");
    const count = Number(goals);
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) throw new Error("Los goles manuales deben ser un número entero entre 0 y 1.000.000.");
    const [player, aggregateGoals] = await Promise.all([
      readJson(baseUrl, idToken, `fantasy/players/${id}`),
      readMetric(baseUrl, idToken, "4eso", "goals", metricAliases.goals)
    ]);
    if (!player || typeof player !== "object") throw new Error("No se encontró el jugador Fantasy.");
    const previous = numberValue(player.manualGoals);
    const updates = {
      [`fantasy/players/${id}/manualGoals`]: count,
      "scores/4eso/goals": Math.max(0, aggregateGoals - previous + count)
    };
    let rewardCoins = 0;
    const owner = player.owner ? validPathSegment(player.owner, "el propietario") : "";
    if (owner) {
      const awardPath = `fantasy/manualGoalAwards/${id}/${owner}`;
      const existingAward = await readJson(baseUrl, idToken, awardPath).catch(() => null);
      const alreadyPaidGoals = numberValue(existingAward?.goals);
      const newGoals = Math.max(0, count - alreadyPaidGoals);
      const perGoal = fantasyCoinsPerGoal(player);
      rewardCoins = newGoals * perGoal;
      updates[awardPath] = {
        goals: Math.max(alreadyPaidGoals, count),
        rewardPerGoal: perGoal,
        totalReward: numberValue(existingAward?.totalReward) + rewardCoins,
        playerName: String(player.name ?? id),
        updatedAt: Date.now()
      };
      if (rewardCoins > 0) {
        const wallet = await getWalletLocation(baseUrl, idToken, owner);
        updates[wallet.path] = wallet.balance + rewardCoins;
      }
    }
    await patchJson(baseUrl, idToken, updates);
    return { playerId: id, manualGoals: count, rewardCoins };
  }

  function matchEntries(collection) {
    if (!collection || typeof collection !== "object") return [];
    return Object.entries(collection).filter(([, match]) => match && typeof match === "object");
  }

  function hasStoredMatches(collection) {
    if (!collection || typeof collection !== "object") return false;
    return Object.values(collection).some((value) => value !== null && value !== undefined);
  }

  async function seedDemoMatches(baseUrl, idToken) {
    const currentCollection = await readJson(baseUrl, idToken, "scores/global/match");
    if (hasStoredMatches(currentCollection)) return currentCollection;

    const aggregatePoints = await Promise.all(gradeIds.map((grade) => (
      readJson(baseUrl, idToken, `scores/${grade}/points`)
    )));
    const maySeed = aggregatePoints.every((value) => (
      value === null || value === undefined || numberValue(value) === 0
    ));
    if (!maySeed) return currentCollection;

    for (const grade of gradeIds) {
      await writeIfMissing(baseUrl, idToken, `scores/${grade}/points`, 0);
      await seedAggregateMetricIfMissing(baseUrl, idToken, grade, "goals", metricAliases.goals);
      await seedAggregateMetricIfMissing(baseUrl, idToken, grade, "currentWinStreak", metricAliases.currentWinStreak);
    }

    for (const demo of demoMatches) {
      const { id, metrics, scorers, ...match } = demo;
      await writeIfMissing(baseUrl, idToken, `scores/global/match/${id}`, { ...match, id, isDemo: true });
      for (const grade of gradeIds) {
        await writeIfMissing(baseUrl, idToken, `scores/${grade}/match/${id}/points`, metrics[grade].points);
        await writeIfMissing(baseUrl, idToken, `scores/${grade}/match/${id}/goals`, metrics[grade].goals);
      }
      if (scorers) {
        await writeIfMissing(baseUrl, idToken, `scores/4eso/match/${id}/scorers`, scorers);
      }
    }
    return readJson(baseUrl, idToken, "scores/global/match");
  }

  async function loadMatches(baseUrl, idToken) {
    let collection = await readJson(baseUrl, idToken, "scores/global/match");
    const initialized = await readJson(baseUrl, idToken, "scores/global/matchesInitialized").catch(() => false);
    if (!hasStoredMatches(collection) && initialized !== true) collection = await seedDemoMatches(baseUrl, idToken);
    const fantasyPlayers = await readJson(baseUrl, idToken, "fantasy/players").catch(() => ({}));
    const matches = await Promise.all(matchEntries(collection).map(async ([key, data]) => {
      const id = safeText(data.id) || key;
      const invalidKey = [".", "#", "$", "[", "]", "/"].some((character) => id.includes(character));
      if (!id || id === "." || id === ".." || invalidKey) {
        throw new Error(`Partidos: identificador de partido no válido: ${key}`);
      }
      const { dateLabel, sortTime } = dateParts(data.datePlayed ?? data.playedAt ?? data.date ?? data.datetime ?? data.timestamp);
      const [scorers, threePoints, fourPoints, threeGoals, fourGoals] = await Promise.all([
        readJson(baseUrl, idToken, `scores/4eso/match/${id}/scorers`),
        readJson(baseUrl, idToken, `scores/3eso/match/${id}/points`),
        readJson(baseUrl, idToken, `scores/4eso/match/${id}/points`),
        readJson(baseUrl, idToken, `scores/3eso/match/${id}/goals`),
        readJson(baseUrl, idToken, `scores/4eso/match/${id}/goals`)
      ]);
      const scorerEntries = scorerCounts(scorers, fantasyPlayers && typeof fantasyPlayers === "object" ? fantasyPlayers : {});
      const resultingScore = data.resultingScore ?? data.finalScore ?? data.result ?? data.score;
      const gradeScores = gradeResults(resultingScore);
      return {
        id,
        dateLabel,
        dateISO: sortTime ? new Date(sortTime).toISOString().slice(0, 10) : "",
        resultText: resultText(resultingScore),
        gradeResults: gradeScores,
        scorelines: Object.fromEntries(gradeIds.map((grade) => [grade, parseScoreline(gradeScores?.[grade])])),
        scorersText: scorerEntries.map(({ name, goals }) => goals > 1 ? `${goals}x ${name}` : name).join(", "),
        scorerEntries,
        sortTime,
        points: { "3eso": numberValue(threePoints), "4eso": numberValue(fourPoints) },
        goals: { "3eso": numberValue(threeGoals), "4eso": numberValue(fourGoals) },
        isDemo: data.isDemo === true || id.startsWith("demo-")
      };
    }));
    return matches.sort((a, b) => b.sortTime - a.sortTime);
  }

  async function loadUserBalance(baseUrl, idToken, username) {
    const name = String(username || "").trim();
    const invalidName = [".", "#", "$", "[", "]", "/"].some((character) => name.includes(character));
    if (!name || invalidName) throw new Error("Partidos: nombre de usuario no válido para leer el saldo.");
    let balance = await readJson(baseUrl, idToken, `users/${name}/money`);
    if (balance === null || balance === undefined) {
      balance = await readJson(baseUrl, idToken, `users/${name}/balance`);
    }
    return numberValue(balance);
  }

  async function load(baseUrl, idToken) {
    const [scores, matches] = await Promise.all([
      loadScores(baseUrl, idToken),
      loadMatches(baseUrl, idToken)
    ]);
    return { scores, matches };
  }

  async function loadFantasyPlayers(baseUrl, idToken) {
    const players = await readJson(baseUrl, idToken, "fantasy/players");
    return Object.entries(players && typeof players === "object" ? players : {})
      .filter(([, player]) => player && typeof player === "object")
      .map(([id, player]) => ({ id, ...player, manualGoals: numberValue(player.manualGoals) }))
      .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), "es"));
  }

  window.PartidosData = Object.freeze({ load, loadScores, loadMatches, loadUserBalance, loadFantasyPlayers, saveMatch, deleteMatch, saveManualGoals });
})();
