(() => {
  function pathSegment(value, label) {
    const text = String(value ?? "").trim();
    if (!text || /[.#$\[\]\/]/.test(text)) throw new Error(`${label} no válido.`);
    return text;
  }

  function databaseUrl(baseUrl, idToken, path) {
    const root = String(baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!root) throw new Error("Falta la URL de Firebase.");
    if (!idToken) throw new Error("Inicia sesión para continuar.");
    const encoded = path ? `${path.split("/").map(encodeURIComponent).join("/")}.json` : ".json";
    return `${root}/${encoded}?auth=${encodeURIComponent(idToken)}`;
  }

  async function request(baseUrl, idToken, path, options = {}) {
    let response;
    try {
      response = await fetch(databaseUrl(baseUrl, idToken, path), {
        method: options.method ?? "GET",
        headers: {
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.headers ?? {})
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        cache: "no-store"
      });
    } catch {
      throw new Error("No se pudo conectar con Firebase. Comprueba tu conexión e inténtalo otra vez.");
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(typeof body === "string" ? body : body?.error || `Firebase devolvió el error ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return { body, response };
  }

  async function read(baseUrl, idToken, path, headers = {}) {
    return (await request(baseUrl, idToken, path, { headers })).body;
  }

  async function write(baseUrl, idToken, path, value, method = "PUT") {
    return request(baseUrl, idToken, path, { method, body: value });
  }

  function safeText(value, maxLength = 240) {
    const text = String(value ?? "").trim();
    if (!text) throw new Error("Escribe un texto antes de continuar.");
    return text.slice(0, maxLength);
  }

  function validMoney(value) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) {
      throw new Error("El saldo debe ser un número entero entre 0 y 1.000.000.000.");
    }
    return amount;
  }

  async function notifyUser(baseUrl, idToken, username, { app = "LaLiga Brains", message, path = "/kingdom" } = {}) {
    const user = pathSegment(username, "El nombre de usuario");
    const notification = {
      app: safeText(app, 80),
      message: safeText(message, 240),
      read: "false",
      path: safeText(path, 300),
      createdAt: Date.now()
    };
    const result = await write(baseUrl, idToken, `notifications/${user}`, notification, "POST");
    return { id: result.body?.name ?? null, ...notification };
  }

  async function submitFeatureRequest(baseUrl, idToken, username, text) {
    const user = pathSegment(username, "El nombre de usuario");
    const requestItem = {
      username: user,
      text: safeText(text, 1000),
      type: "feature",
      status: "pending",
      createdAt: Date.now(),
      response: ""
    };
    const id = `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await write(baseUrl, idToken, "", {
      [`kingdom/featureRequests/${id}`]: requestItem,
      [`kingdom/requestsByUser/${user}/${id}`]: requestItem
    }, "PATCH");
    return { id, ...requestItem };
  }

  async function listFeatureRequests(baseUrl, idToken, username, { admin = false } = {}) {
    const user = pathSegment(username, "El nombre de usuario");
    const path = admin ? "kingdom/featureRequests" : `kingdom/requestsByUser/${user}`;
    const collection = await read(baseUrl, idToken, path);
    return Object.entries(collection && typeof collection === "object" ? collection : {})
      .filter(([, item]) => item && typeof item === "object")
      .map(([id, item]) => ({ id, ...item }))
      .filter((item) => admin || item.username === user)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  async function respondFeatureRequest(baseUrl, idToken, id, responseText) {
    const requestId = pathSegment(id, "El identificador de solicitud");
    const response = safeText(responseText, 1000);
    const item = await read(baseUrl, idToken, `kingdom/featureRequests/${requestId}`);
    if (!item || typeof item !== "object") throw new Error("No se encontró esta solicitud.");
    const updated = { status: "responded", response, respondedAt: Date.now() };
    const update = {
      [`kingdom/featureRequests/${requestId}/status`]: updated.status,
      [`kingdom/featureRequests/${requestId}/response`]: updated.response,
      [`kingdom/featureRequests/${requestId}/respondedAt`]: updated.respondedAt
    };
    if (item.username) {
      const user = pathSegment(item.username, "El nombre de usuario");
      update[`kingdom/requestsByUser/${user}/${requestId}/status`] = updated.status;
      update[`kingdom/requestsByUser/${user}/${requestId}/response`] = updated.response;
      update[`kingdom/requestsByUser/${user}/${requestId}/respondedAt`] = updated.respondedAt;
    }
    await write(baseUrl, idToken, "", update, "PATCH");
    if (item.username) {
      try {
        await notifyUser(baseUrl, idToken, item.username, {
          app: "Reino",
          message: "Han respondido a tu solicitud.",
          path: `/reino/solicitudes/${encodeURIComponent(requestId)}`
        });
      } catch {
        // The reply is saved even when notification delivery is unavailable.
      }
    }
    return { ...item, ...updated };
  }

  async function listAnnouncements(baseUrl, idToken) {
    const collection = await read(baseUrl, idToken, "announcements");
    return Object.entries(collection && typeof collection === "object" ? collection : {})
      .filter(([, item]) => item && typeof item === "object")
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  const defaultSettings = Object.freeze({
    publicName: "Adri",
    maxFantasyPlayers: 3,
    assignmentRewardRate: 0.1,
    minHours: 1,
    maxHours: 8,
    startingCoins: 100,
    predictionsEnabled: true
  });

  function validateSettings(settings) {
    const publicName = safeText(settings?.publicName ?? defaultSettings.publicName, 50);
    const maxFantasyPlayers = Number(settings?.maxFantasyPlayers ?? defaultSettings.maxFantasyPlayers);
    const assignmentRewardRate = Number(settings?.assignmentRewardRate ?? defaultSettings.assignmentRewardRate);
    const minHours = Number(settings?.minHours ?? defaultSettings.minHours);
    const maxHours = Number(settings?.maxHours ?? defaultSettings.maxHours);
    const startingCoins = Number(settings?.startingCoins ?? defaultSettings.startingCoins);
    if (!Number.isInteger(maxFantasyPlayers) || maxFantasyPlayers < 1 || maxFantasyPlayers > 10) {
      throw new Error("El límite de jugadores Fantasy debe estar entre 1 y 10.");
    }
    if (!Number.isFinite(assignmentRewardRate) || assignmentRewardRate < 0 || assignmentRewardRate > 1) {
      throw new Error("La recompensa por hora debe estar entre 0 y 1.");
    }
    if (!Number.isInteger(minHours) || !Number.isInteger(maxHours) || minHours < 1 || maxHours > 8 || minHours > maxHours) {
      throw new Error("El rango de duración debe ser de 1 a 8 horas y el mínimo no puede superar el máximo.");
    }
    if (!Number.isSafeInteger(startingCoins) || startingCoins < 0 || startingCoins > 1000000) {
      throw new Error("Las monedas iniciales deben ser un entero entre 0 y 1.000.000.");
    }
    return {
      ...defaultSettings,
      publicName,
      maxFantasyPlayers,
      assignmentRewardRate,
      minHours,
      maxHours,
      startingCoins,
      predictionsEnabled: settings?.predictionsEnabled === undefined
        ? defaultSettings.predictionsEnabled
        : Boolean(settings.predictionsEnabled)
    };
  }

  async function loadSettings(baseUrl, idToken) {
    const stored = await read(baseUrl, idToken, "kingdom/settings");
    return validateSettings(stored && typeof stored === "object" ? stored : defaultSettings);
  }

  async function saveSettings(baseUrl, idToken, settings) {
    const validated = validateSettings(settings);
    await request(baseUrl, idToken, "kingdom/settings", { method: "PATCH", body: validated });
    return validated;
  }

  async function listUsers(baseUrl, idToken) {
    const collection = await read(baseUrl, idToken, "users");
    return Object.entries(collection && typeof collection === "object" ? collection : {})
      .filter(([, item]) => item && typeof item === "object")
      .map(([username, item]) => ({
        username,
        name: String(item.name ?? username),
        membership: String(item.membership ?? ""),
        money: numberAmount(item.money ?? item.balance),
        balanceField: item.money !== null && item.money !== undefined ? "money" : "balance",
        profilePicture: item.profilePicture ?? null
      }))
      .sort((a, b) => a.username.localeCompare(b.username, "es"));
  }

  function numberAmount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }

  async function createAnnouncement(baseUrl, idToken, username, announcement) {
    const author = pathSegment(username, "El nombre de usuario");
    const item = {
      title: safeText(announcement?.title, 100),
      message: safeText(announcement?.message, 1200),
      author,
      createdAt: Date.now()
    };
    const created = await write(baseUrl, idToken, "announcements", item, "POST");
    const id = pathSegment(created.body?.name, "El identificador del anuncio");
    let notified = 0;
    try {
      const users = await listUsers(baseUrl, idToken);
      const updates = {};
      for (const user of users) {
        const target = pathSegment(user.username, "El nombre de usuario");
        updates[`notifications/${target}/announcement-${id}`] = {
          app: "Reino",
          message: item.title,
          read: "false",
          path: `/reino/anuncios/${encodeURIComponent(id)}`,
          createdAt: item.createdAt
        };
        notified += 1;
      }
      if (notified) await write(baseUrl, idToken, "", updates, "PATCH");
    } catch {
      // The public announcement remains available in the Kingdom app.
      notified = 0;
    }
    return { id, ...item, notified };
  }

  async function getWalletSnapshot(baseUrl, idToken, username) {
    const user = pathSegment(username, "El nombre de usuario");
    for (const field of ["money", "balance"]) {
      const { body, response } = await request(baseUrl, idToken, `users/${user}/${field}`, {
        headers: { "X-Firebase-ETag": "true" }
      });
      if (body !== null && body !== undefined) {
        const balance = Number(body);
        if (!Number.isSafeInteger(balance) || balance < 0) throw new Error(`El saldo de ${user} no es válido.`);
        return { user, field, balance, etag: response.headers.get("ETag") };
      }
    }
    return { user, field: "money", balance: 0, etag: null };
  }

  async function changeMoney(baseUrl, idToken, username, operation, amount) {
    const user = pathSegment(username, "El nombre de usuario");
    const value = validMoney(amount);
    if (operation === "add" && value === 0) throw new Error("La cantidad que quieres añadir debe ser mayor que cero.");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const snapshot = await getWalletSnapshot(baseUrl, idToken, user);
      const next = operation === "add" ? snapshot.balance + value : value;
      if (!Number.isSafeInteger(next) || next > 1000000000) throw new Error("El saldo supera el límite permitido.");
      try {
        if (!snapshot.etag) {
          await write(baseUrl, idToken, `users/${user}/${snapshot.field}`, next);
        } else {
          await request(baseUrl, idToken, `users/${user}/${snapshot.field}`, {
            method: "PUT",
            headers: { "If-Match": snapshot.etag },
            body: next
          });
        }
        return { username: user, previous: snapshot.balance, money: next };
      } catch (error) {
        if (error.status !== 412) throw error;
      }
    }
    throw new Error("El saldo cambió a la vez en otra acción. Actualiza la página e inténtalo de nuevo.");
  }

  function setUserMoney(baseUrl, idToken, username, amount) {
    return changeMoney(baseUrl, idToken, username, "set", amount);
  }

  function addUserMoney(baseUrl, idToken, username, amount) {
    return changeMoney(baseUrl, idToken, username, "add", amount);
  }

  async function loadFantasyPlayers(baseUrl, idToken) {
    const players = await read(baseUrl, idToken, "fantasy/players");
    return Object.entries(players && typeof players === "object" ? players : {})
      .filter(([, player]) => player && typeof player === "object")
      .map(([id, player]) => ({ id, ...player }))
      .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), "es"));
  }

  async function savePlayer(baseUrl, idToken, playerId, player) {
    const id = pathSegment(playerId, "El identificador del jugador");
    if (!player || typeof player !== "object" || Array.isArray(player)) throw new Error("Los datos del jugador no son válidos.");
    const name = safeText(player.name, 80);
    const cost = validMoney(player.cost ?? player.value);
    const value = validMoney(player.value ?? player.cost);
    const owner = player.owner === null || player.owner === undefined || player.owner === ""
      ? null
      : pathSegment(player.owner, "El propietario");
    const record = { ...player, name, cost, value, owner };
    const previous = await read(baseUrl, idToken, `fantasy/players/${id}`).catch(() => null);
    const previousOwner = previous?.owner ? pathSegment(previous.owner, "El propietario anterior") : null;
    const updates = { [`fantasy/players/${id}`]: record };
    let previousEntry = null;
    if (previousOwner && previousOwner !== owner) {
      const oldTeam = await read(baseUrl, idToken, `fantasy/teams/${previousOwner}/players/${id}`).catch(() => null);
      previousEntry = oldTeam && typeof oldTeam === "object" ? oldTeam : null;
      updates[`fantasy/teams/${previousOwner}/players/${id}`] = null;
    } else if (previousOwner && previousOwner === owner) {
      previousEntry = await read(baseUrl, idToken, `fantasy/teams/${owner}/players/${id}`).catch(() => null);
    }
    if (owner) {
      const settings = await loadSettings(baseUrl, idToken).catch(() => defaultSettings);
      const newTeam = await read(baseUrl, idToken, `fantasy/teams/${owner}/players`).catch(() => null);
      const maxPlayers = Number(settings.maxFantasyPlayers) || 3;
      const roster = newTeam && typeof newTeam === "object" ? newTeam : {};
      if (previousOwner !== owner && Object.keys(roster).length >= maxPlayers && !roster[id]) {
        throw new Error(`El equipo de ${owner} ya tiene el máximo de ${maxPlayers} jugadores.`);
      }
      updates[`fantasy/teams/${owner}/players/${id}`] = {
        ...(previousEntry && typeof previousEntry === "object" ? previousEntry : {}),
        name,
        value,
        investment: Number(previousEntry?.investment) || 0
      };
    }
    await request(baseUrl, idToken, "", { method: "PATCH", body: updates });
    if (previousOwner && previousOwner !== owner) {
      try {
        await notifyUser(baseUrl, idToken, previousOwner, {
          app: "Fantasy",
          message: `Has perdido a ${String(previous?.name ?? name)}; su equipo ha cambiado.`,
          path: "/fantasy/log"
        });
        await createActivity(baseUrl, idToken, {
          type: "ownership-change",
          actor: "adri",
          target: previousOwner,
          playerId: id,
          playerName: String(previous?.name ?? name),
          message: `${String(previous?.name ?? name)} dejó el equipo de ${previousOwner}.`
        });
      } catch {
        // The ownership update remains committed if notification delivery fails.
      }
    }
    return { id, ...record };
  }

  async function createActivity(baseUrl, idToken, activity) {
    if (!activity || typeof activity !== "object") throw new Error("El evento no es válido.");
    const record = {
      type: safeText(activity.type, 50),
      message: safeText(activity.message, 240),
      ...(activity.actor ? { actor: pathSegment(activity.actor, "El usuario") } : {}),
      ...(activity.playerId ? { playerId: pathSegment(activity.playerId, "El jugador") } : {}),
      ...(activity.playerName ? { playerName: safeText(activity.playerName, 80) } : {}),
      ...(activity.target ? { target: pathSegment(activity.target, "El destinatario") } : {}),
      ...(activity.details && typeof activity.details === "object" ? { details: activity.details } : {}),
      createdAt: Date.now()
    };
    const id = `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const update = { [`fantasy/activity/${id}`]: record };
    const indexedUsers = new Set([record.actor, record.target].filter(Boolean));
    for (const username of indexedUsers) {
      const user = pathSegment(username, "El usuario");
      update[`fantasy/activityByUser/${user}/${id}`] = record;
    }
    await write(baseUrl, idToken, "", update, "PATCH");
    return { id, ...record };
  }

  async function listActivity(baseUrl, idToken, { admin = false, username } = {}) {
    const viewer = admin ? "" : pathSegment(username, "El nombre de usuario");
    const collection = await read(baseUrl, idToken, admin ? "fantasy/activity" : `fantasy/activityByUser/${viewer}`);
    return Object.entries(collection && typeof collection === "object" ? collection : {})
      .filter(([, item]) => item && typeof item === "object")
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  async function recordPurchase(baseUrl, idToken, purchase) {
    return createActivity(baseUrl, idToken, {
      type: "purchase",
      actor: purchase?.buyer,
      playerId: purchase?.playerId,
      playerName: purchase?.playerName,
      message: `${String(purchase?.buyer ?? "Un usuario")} fichó a ${String(purchase?.playerName ?? purchase?.playerId ?? "un jugador")}.`,
      details: { cost: validMoney(purchase?.cost ?? 0) }
    });
  }

  async function notifyMatch(baseUrl, idToken, username, match) {
    const matchId = pathSegment(match?.id, "El identificador del partido");
    const isLatest = match?.isLatest === true;
    return notifyUser(baseUrl, idToken, username, {
      app: "Partidos",
      message: `Nuevo resultado registrado: ${String(match?.resultText ?? "partido actualizado")}.`,
      path: isLatest ? `/partidos/latest/${encodeURIComponent(matchId)}` : `/partidos/matches/${encodeURIComponent(matchId)}`
    });
  }

  async function loadKingdomData(baseUrl, idToken, username, { admin = false } = {}) {
    const [featureRequests, announcements, players, activity, users, settings] = await Promise.all([
      listFeatureRequests(baseUrl, idToken, username, { admin }),
      listAnnouncements(baseUrl, idToken),
      loadFantasyPlayers(baseUrl, idToken),
      listActivity(baseUrl, idToken, { admin, username }),
      admin ? listUsers(baseUrl, idToken) : Promise.resolve([]),
      loadSettings(baseUrl, idToken)
    ]);
    return { featureRequests, announcements, players, activity, users, settings };
  }

  window.KingdomData = Object.freeze({
    submitFeatureRequest,
    listFeatureRequests,
    respondFeatureRequest,
    listAnnouncements,
    createAnnouncement,
    listUsers,
    loadSettings,
    saveSettings,
    loadKingdomData,
    setUserMoney,
    addUserMoney,
    loadFantasyPlayers,
    savePlayer,
    createActivity,
    listActivity,
    recordPurchase,
    notifyUser,
    notifyMatch
  });
})();
