(() => {
  const demoPlayers = {
    fer: { name: "Fer", cost: 10, value: 10, owner: null },
    alex: { name: "Alex", cost: 15, value: 15, owner: null },
    victor: { name: "Victor", cost: 20, value: 20, owner: null }
  };

  function validateSegment(value, label) {
    const segment = String(value ?? "");
    if (!segment || /[.#$\[\]\/]/.test(segment)) {
      throw new Error(`Invalid ${label}.`);
    }
    return segment;
  }

  function databaseUrl(baseUrl, path, idToken) {
    const root = String(baseUrl ?? "").replace(/\/+$/, "");
    if (!root) throw new Error("Firebase database URL is required.");
    if (!idToken) throw new Error("A signed-in Firebase ID token is required.");
    const encodedPath = path
      ? `${path.split("/").map(encodeURIComponent).join("/")}.json`
      : ".json";
    return `${root}/${encodedPath}?auth=${encodeURIComponent(idToken)}`;
  }

  async function request(baseUrl, idToken, path, { method = "GET", body, headers = {} } = {}) {
    let response;
    try {
      response = await fetch(databaseUrl(baseUrl, path, idToken), {
        method,
        headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch {
      throw new Error("Firebase request failed. Check the network connection.");
    }

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof result === "string" ? result : result?.error;
      throw new Error(detail ? `Firebase request failed: ${detail}` : `Firebase request failed (${response.status}).`);
    }
    return result;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function teamPlayerEntries(team) {
    const players = team && typeof team === "object" ? team.players ?? team : {};
    if (Array.isArray(players)) {
      return players.map((player, index) => [String(player?.playerId ?? player?.id ?? index), player]);
    }
    if (!players || typeof players !== "object") return [];
    return Object.entries(players).filter(([, player]) => player && typeof player === "object");
  }

  async function loadReminders(baseUrl, idToken, username) {
    const user = validateSegment(username, "username");
    return (await request(baseUrl, idToken, `reminders/${user}`)) ?? {};
  }

  async function addReminder(baseUrl, idToken, username, reminder) {
    const user = validateSegment(username, "username");
    if (!reminder || typeof reminder !== "object" || Array.isArray(reminder)) {
      throw new Error("A reminder object is required.");
    }
    const created = await request(baseUrl, idToken, `reminders/${user}`, { method: "POST", body: reminder });
    return { id: created?.name ?? null, ...reminder };
  }

  async function setReminderDone(baseUrl, idToken, username, reminderId, done) {
    const user = validateSegment(username, "username");
    const id = validateSegment(reminderId, "reminder ID");
    return request(baseUrl, idToken, `reminders/${user}/${id}`, {
      method: "PATCH",
      body: { done: Boolean(done) }
    });
  }

  async function deleteReminder(baseUrl, idToken, username, reminderId) {
    const user = validateSegment(username, "username");
    const id = validateSegment(reminderId, "reminder ID");
    await request(baseUrl, idToken, `reminders/${user}/${id}`, { method: "DELETE" });
    return true;
  }

  async function loadProfile(baseUrl, idToken, username) {
    const user = validateSegment(username, "username");
    const profile = (await request(baseUrl, idToken, `users/${user}`)) ?? {};
    return {
      name: profile.name ?? null,
      membership: profile.membership ?? null,
      profilePicture: profile.profilePicture ?? null,
      profileBackground: profile.profileBackground ?? null,
      money: profile.money ?? null
    };
  }

  async function saveProfilePicture(baseUrl, idToken, username, profilePicture) {
    const user = validateSegment(username, "username");
    if (typeof profilePicture !== "string" || profilePicture.length === 0) {
      throw new Error("A profile picture value is required.");
    }
    return request(baseUrl, idToken, `users/${user}/profilePicture`, {
      method: "PUT",
      body: profilePicture
    });
  }

  async function saveProfileAppearance(baseUrl, idToken, username, profilePicture, profileBackground) {
    const user = validateSegment(username, "username");
    if (typeof profilePicture !== "string" || !profilePicture.trim() || Array.from(profilePicture).length > 12) {
      throw new Error("Introduce un emoji válido para el perfil.");
    }
    if (typeof profileBackground !== "string" || !/^#[\da-f]{6}$/i.test(profileBackground)) {
      throw new Error("Elige un color válido para el fondo.");
    }
    return request(baseUrl, idToken, `users/${user}`, {
      method: "PATCH",
      body: { profilePicture: profilePicture.trim(), profileBackground }
    });
  }

  async function deleteAccountData(baseUrl, idToken, username, firebaseApiKey) {
    const user = validateSegment(username, "username");
    if (!firebaseApiKey) throw new Error("Firebase API key is required to delete the account.");

    const [ownRequests, ownTeam, ownActivity, outgoingRequests, transferRequests] = await Promise.all([
      request(baseUrl, idToken, `kingdom/requestsByUser/${user}`),
      request(baseUrl, idToken, `fantasy/teams/${user}`),
      request(baseUrl, idToken, `fantasy/activityByUser/${user}`),
      request(baseUrl, idToken, `fantasy/outgoingTransferRequests/${user}`),
      request(baseUrl, idToken, "fantasy/transferRequests").catch(() => null)
    ]);
    const cleanup = {
      [`users/${user}`]: null,
      [`notifications/${user}`]: null,
      [`reminders/${user}`]: null,
      [`predictions/${user}`]: null,
      [`fantasy/teams/${user}`]: null,
      [`fantasy/assignments/${user}`]: null,
      [`fantasy/transferRequests/${user}`]: null,
      [`fantasy/outgoingTransferRequests/${user}`]: null,
      [`fantasy/activityByUser/${user}`]: null,
      [`kingdom/requestsByUser/${user}`]: null
    };
    for (const [playerId] of teamPlayerEntries(ownTeam)) {
      try {
        cleanup[`fantasy/players/${validateSegment(playerId, "player ID")}/owner`] = null;
      } catch {
        // Ignore malformed legacy player keys instead of aborting the full cleanup.
      }
    }
    for (const activityId of Object.keys(ownActivity || {})) {
      try {
        cleanup[`fantasy/activity/${validateSegment(activityId, "activity ID")}`] = null;
      } catch {
        // Ignore malformed legacy activity keys.
      }
    }
    const outgoingIds = new Set(Object.keys(outgoingRequests || {}));
    for (const [owner, requests] of Object.entries(transferRequests || {})) {
      for (const [requestId, item] of Object.entries(requests || {})) {
        if (item?.fromUsername === user) outgoingIds.add(`${owner}/${requestId}`);
      }
    }
    for (const indexedRequest of outgoingIds) {
      const [owner, requestId] = indexedRequest.includes("/")
        ? indexedRequest.split("/", 2)
        : [outgoingRequests?.[indexedRequest]?.owner, indexedRequest];
      if (!owner || owner === user) continue;
      try {
        const safeOwner = validateSegment(owner, "transfer owner");
        const safeRequestId = validateSegment(requestId, "transfer request ID");
        cleanup[`fantasy/transferRequests/${safeOwner}/${safeRequestId}`] = null;
      } catch {
        // Ignore malformed legacy transfer keys.
      }
    }
    for (const requestId of Object.keys(ownRequests || {})) {
      if (/^[.#$\[\]\/]/.test(requestId)) continue;
      cleanup[`kingdom/featureRequests/${requestId}`] = null;
    }

    await request(baseUrl, idToken, "", {
      method: "PATCH",
      body: cleanup
    });

    let response;
    try {
      response = await fetch(`${window.location.origin}/identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(firebaseApiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
      });
    } catch {
      throw new Error("Account data was removed, but Firebase Authentication could not be reached to delete the account.");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = result?.error?.message;
      throw new Error(detail
        ? `Account data was removed, but Firebase Authentication could not delete the account: ${detail}`
        : `Account data was removed, but Firebase Authentication could not delete the account (${response.status}).`);
    }
    return { dataDeleted: true, authDeleted: true };
  }

  async function loadFantasy(baseUrl, idToken, username) {
    const user = validateSegment(username, "username");
    let [players, team, money, settings] = await Promise.all([
      request(baseUrl, idToken, "fantasy/players"),
      request(baseUrl, idToken, `fantasy/teams/${user}`),
      request(baseUrl, idToken, `users/${user}/money`),
      request(baseUrl, idToken, "kingdom/settings").catch(() => null)
    ]);
    const maxPlayers = Number(settings?.maxFantasyPlayers) > 0 ? Number(settings.maxFantasyPlayers) : 3;
    const startingCoins = Number.isSafeInteger(Number(settings?.startingCoins)) && Number(settings.startingCoins) >= 0
      ? Number(settings.startingCoins)
      : 100;

    if (players === null || (players && typeof players === "object" && !Array.isArray(players) && Object.keys(players).length === 0)) {
      await request(baseUrl, idToken, "fantasy/players", { method: "PATCH", body: demoPlayers });
      players = { ...demoPlayers };
    }

    if (money === null || money === undefined) {
      const legacyBalance = await request(baseUrl, idToken, `users/${user}/balance`).catch(() => null);
      const initialMoney = legacyBalance === null || legacyBalance === undefined ? startingCoins : legacyBalance;
      await request(baseUrl, idToken, `users/${user}/money`, { method: "PUT", body: initialMoney });
      money = initialMoney;
    }

    const balance = numberOrNull(money);
    if (balance === null) throw new Error("Fantasy balance must be a number.");
    const safeTeam = team && typeof team === "object" ? team : { players: {} };
    return {
      players: players && typeof players === "object" ? players : {},
      team: safeTeam,
      roster: teamPlayerEntries(safeTeam).map(([id, player]) => ({ id, ...player })),
      balance,
      maxPlayers
    };
  }

  function fantasyPathSegment(value, label) {
    return validateSegment(value, label);
  }

  async function buyPlayer(baseUrl, idToken, username, playerId) {
    const user = fantasyPathSegment(username, "username");
    const id = fantasyPathSegment(playerId, "player ID");
    const fantasy = await loadFantasy(baseUrl, idToken, user);
    const player = fantasy.players[id];
    if (!player || typeof player !== "object") throw new Error("That player is not in the market.");
    if (player.owner !== null && player.owner !== undefined && player.owner !== "") {
      throw new Error("That player already has an owner.");
    }
    if (fantasy.roster.length >= fantasy.maxPlayers) throw new Error(`Tu equipo puede tener como máximo ${fantasy.maxPlayers} jugadores.`);

    const cost = numberOrNull(player.value ?? player.cost ?? player.price);
    if (cost === null || cost <= 0) throw new Error("This player has an invalid cost.");
    if (fantasy.balance < cost) throw new Error("There are not enough coins to buy this player.");
    const value = cost;
    const entry = { name: player.name ?? id, value, investment: 0 };
    await request(baseUrl, idToken, "", {
      method: "PATCH",
      body: {
        [`users/${user}/money`]: fantasy.balance - cost,
        [`fantasy/players/${id}/owner`]: user,
        [`fantasy/players/${id}/value`]: value,
        [`fantasy/teams/${user}/players/${id}`]: entry
      }
    });

    return {
      balance: fantasy.balance - cost,
      player: { ...player, owner: user, value },
      team: { ...fantasy.team, players: { ...(fantasy.team.players || {}), [id]: entry } }
    };
  }

  async function investPlayer(baseUrl, idToken, username, playerId, amount) {
    const user = fantasyPathSegment(username, "username");
    const id = fantasyPathSegment(playerId, "player ID");
    const investment = numberOrNull(amount);
    if (investment === null || investment <= 0) throw new Error("Investment must be a positive amount.");

    const fantasy = await loadFantasy(baseUrl, idToken, user);
    const player = fantasy.players[id];
    const teamEntry = fantasy.team?.players?.[id];
    if (!player || typeof player !== "object" || player.owner !== user || !teamEntry) {
      throw new Error("You can only invest in a player on your team.");
    }
    if (fantasy.balance < investment) throw new Error("There are not enough coins to invest this amount.");

    const currentValue = numberOrNull(player.value ?? player.cost) ?? 0;
    const currentInvestment = numberOrNull(teamEntry.investment) ?? 0;
    const newValue = currentValue + investment;
    const newInvestment = currentInvestment + investment;
    await request(baseUrl, idToken, "", {
      method: "PATCH",
      body: {
        [`users/${user}/money`]: fantasy.balance - investment,
        [`fantasy/players/${id}/value`]: newValue,
        [`fantasy/teams/${user}/players/${id}/value`]: newValue,
        [`fantasy/teams/${user}/players/${id}/investment`]: newInvestment
      }
    });

    return {
      balance: fantasy.balance - investment,
      player: { ...player, value: newValue },
      team: {
        ...fantasy.team,
        players: {
          ...(fantasy.team.players || {}),
          [id]: { ...teamEntry, value: newValue, investment: newInvestment }
        }
      }
    };
  }

  async function sellPlayer(baseUrl, idToken, username, playerId) {
    const user = validateSegment(username, "username");
    const id = validateSegment(playerId, "player ID");
    const fantasy = await loadFantasy(baseUrl, idToken, user);
    const player = fantasy.players[id];
    const teamEntry = fantasy.team?.players?.[id];
    if (!player || typeof player !== "object" || player.owner !== user || !teamEntry) {
      throw new Error("The player is no longer on your team.");
    }
    const marketValue = numberOrNull(player.value ?? teamEntry.value ?? player.cost);
    if (!Number.isSafeInteger(marketValue) || marketValue <= 0) throw new Error("This player has an invalid market value.");

    const pendingOffers = await request(baseUrl, idToken, `fantasy/transferRequests/${user}`).catch(() => null);
    const updates = {
      [`users/${user}/money`]: fantasy.balance + marketValue,
      [`fantasy/players/${id}/owner`]: null,
      [`fantasy/players/${id}/cost`]: marketValue,
      [`fantasy/players/${id}/value`]: marketValue,
      [`fantasy/teams/${user}/players/${id}`]: null
    };
    for (const [offerId, offer] of Object.entries(pendingOffers || {})) {
      if (offer?.playerId !== id || (offer.status !== "pending" && offer.pending !== true)) continue;
      const safeOfferId = validateSegment(offerId, "offer ID");
      const buyer = validateSegment(offer.fromUsername, "offering username");
      updates[`fantasy/transferRequests/${user}/${safeOfferId}/status`] = "stale";
      updates[`fantasy/transferRequests/${user}/${safeOfferId}/pending`] = false;
      updates[`fantasy/outgoingTransferRequests/${buyer}/${safeOfferId}/status`] = "stale";
      updates[`fantasy/outgoingTransferRequests/${buyer}/${safeOfferId}/pending`] = false;
    }
    await request(baseUrl, idToken, "", { method: "PATCH", body: updates });
    return { balance: fantasy.balance + marketValue, player: { ...player, owner: null, cost: marketValue, value: marketValue }, marketValue };
  }

  async function submitTransferOffer(baseUrl, idToken, fromUsername, owner, playerId, amount) {
    const requester = validateSegment(fromUsername, "requesting username");
    const currentOwner = validateSegment(owner, "player owner");
    const id = validateSegment(playerId, "player ID");
    const offerAmount = numberOrNull(amount);
    if (!Number.isSafeInteger(offerAmount) || offerAmount <= 0) throw new Error("Offer must be a positive whole number of coins.");
    if (requester === currentOwner) throw new Error("You cannot make an offer to yourself.");

    const [player, buyerBalance, buyerTeam, settings] = await Promise.all([
      request(baseUrl, idToken, `fantasy/players/${id}`),
      request(baseUrl, idToken, `users/${requester}/money`),
      request(baseUrl, idToken, `fantasy/teams/${requester}`),
      request(baseUrl, idToken, "kingdom/settings").catch(() => null)
    ]);
    if (!player || typeof player !== "object") throw new Error("That player does not exist.");
    if (player.owner !== currentOwner) throw new Error("That player is no longer owned by this user.");
    if (numberOrNull(buyerBalance) === null) throw new Error("Your coin balance could not be loaded.");
    if (offerAmount > Number(buyerBalance)) throw new Error("There are not enough coins to make this offer.");
    const maxPlayers = Number(settings?.maxFantasyPlayers) > 0 ? Number(settings.maxFantasyPlayers) : 3;
    const teamPlayers = teamPlayerEntries(buyerTeam);
    if (teamPlayers.length >= maxPlayers && !buyerTeam?.players?.[id]) throw new Error(`Tu equipo ya tiene ${maxPlayers} jugadores.`);

    const requestId = `offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const marketValue = numberOrNull(player.value ?? player.cost ?? player.price) ?? 0;
    const transferRequest = {
      fromUsername: requester,
      playerId: id,
      playerName: player.name ?? id,
      owner: currentOwner,
      amount: offerAmount,
      marketValue,
      status: "pending",
      pending: true,
      createdAt: Date.now()
    };
    await request(baseUrl, idToken, "", {
      method: "PATCH",
      body: {
        [`fantasy/transferRequests/${currentOwner}/${requestId}`]: transferRequest,
        [`fantasy/outgoingTransferRequests/${requester}/${requestId}`]: { owner: currentOwner, playerId: id, playerName: transferRequest.playerName, amount: offerAmount, marketValue, status: "pending", pending: true, createdAt: transferRequest.createdAt }
      }
    });
    return { id: requestId, ...transferRequest };
  }

  async function listTransferRequests(baseUrl, idToken, owner) {
    const currentOwner = validateSegment(owner, "player owner");
    const requests = await request(baseUrl, idToken, `fantasy/transferRequests/${currentOwner}`);
    if (!requests || typeof requests !== "object") return [];
    return Object.entries(requests)
      .filter(([, item]) => item && typeof item === "object" && (item.status === "pending" || item.pending === true))
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  }

  async function listOutgoingTransferOffers(baseUrl, idToken, username) {
    const user = validateSegment(username, "username");
    const offers = await request(baseUrl, idToken, `fantasy/outgoingTransferRequests/${user}`);
    if (!offers || typeof offers !== "object") return [];
    return Object.entries(offers)
      .filter(([, item]) => item && typeof item === "object")
      .map(([id, item]) => ({ id, ...item, status: item.status || (item.pending === false ? "stale" : "pending") }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  async function approveTransferRequest(baseUrl, idToken, owner, requestId) {
    const currentOwner = validateSegment(owner, "player owner");
    const requestKey = validateSegment(requestId, "transfer request ID");
    const transferRequest = await request(baseUrl, idToken, `fantasy/transferRequests/${currentOwner}/${requestKey}`);
    if (!transferRequest || transferRequest.status !== "pending" || transferRequest.pending !== true) {
      throw new Error("This transfer request is no longer pending.");
    }

    const requester = validateSegment(transferRequest.fromUsername, "requesting username");
    const playerId = validateSegment(transferRequest.playerId, "player ID");
    if (requester === currentOwner) throw new Error("Invalid transfer request owner.");

    const [player, ownerTeam, requesterTeam, settings, ownerBalanceValue, requesterBalanceValue] = await Promise.all([
      request(baseUrl, idToken, `fantasy/players/${playerId}`),
      request(baseUrl, idToken, `fantasy/teams/${currentOwner}`),
      request(baseUrl, idToken, `fantasy/teams/${requester}`),
      request(baseUrl, idToken, "kingdom/settings").catch(() => null),
      request(baseUrl, idToken, `users/${currentOwner}/money`),
      request(baseUrl, idToken, `users/${requester}/money`)
    ]);
    if (!player || player.owner !== currentOwner) throw new Error("The player is no longer owned by this user.");
    const offerAmount = numberOrNull(transferRequest.amount);
    const ownerBalance = numberOrNull(ownerBalanceValue);
    const requesterBalance = numberOrNull(requesterBalanceValue);
    if (!Number.isSafeInteger(offerAmount) || offerAmount <= 0) throw new Error("This offer has an invalid amount.");
    if (ownerBalance === null || requesterBalance === null) throw new Error("A user's coin balance could not be loaded.");
    if (requesterBalance < offerAmount) throw new Error("The buyer no longer has enough coins for this offer.");

    const ownerPlayers = { ...(ownerTeam?.players || {}) };
    const requesterPlayers = { ...(requesterTeam?.players || {}) };
    const maxPlayers = Number(settings?.maxFantasyPlayers) > 0 ? Number(settings.maxFantasyPlayers) : 3;
    if (Object.keys(requesterPlayers).length >= maxPlayers && !requesterPlayers[playerId]) {
      throw new Error(`El equipo receptor ya tiene ${maxPlayers} jugadores.`);
    }

    const formerEntry = ownerPlayers[playerId] && typeof ownerPlayers[playerId] === "object"
      ? ownerPlayers[playerId]
      : {};
    const playerValue = numberOrNull(player.value ?? formerEntry.value ?? player.cost) ?? 0;
    const investedAmount = numberOrNull(formerEntry.investment ?? player.investment) ?? 0;
    const newTeamEntry = {
      ...formerEntry,
      playerId,
      name: formerEntry.name ?? transferRequest.playerName ?? player.name ?? playerId,
      value: playerValue,
      investment: investedAmount
    };

    await request(baseUrl, idToken, "", {
      method: "PATCH",
      body: {
        [`fantasy/players/${playerId}/owner`]: requester,
        [`fantasy/teams/${currentOwner}/players/${playerId}`]: null,
        [`fantasy/teams/${requester}/players/${playerId}`]: newTeamEntry,
        [`users/${requester}/money`]: requesterBalance - offerAmount,
        [`users/${currentOwner}/money`]: ownerBalance + offerAmount,
        [`fantasy/transferRequests/${currentOwner}/${requestKey}/status`]: "approved",
        [`fantasy/transferRequests/${currentOwner}/${requestKey}/pending`]: false,
        [`fantasy/outgoingTransferRequests/${requester}/${requestKey}/status`]: "approved",
        [`fantasy/outgoingTransferRequests/${requester}/${requestKey}/pending`]: false
      }
    });
    return { ...newTeamEntry, owner: requester };
  }

  async function declineTransferRequest(baseUrl, idToken, owner, requestId) {
    const currentOwner = validateSegment(owner, "player owner");
    const requestKey = validateSegment(requestId, "transfer request ID");
    const transferRequest = await request(baseUrl, idToken, `fantasy/transferRequests/${currentOwner}/${requestKey}`);
    if (!transferRequest || transferRequest.status !== "pending" || transferRequest.pending !== true) {
      throw new Error("This transfer request is no longer pending.");
    }
    const requester = validateSegment(transferRequest.fromUsername, "requesting username");
    await request(baseUrl, idToken, "", {
      method: "PATCH",
      body: {
        [`fantasy/transferRequests/${currentOwner}/${requestKey}/status`]: "declined",
        [`fantasy/transferRequests/${currentOwner}/${requestKey}/pending`]: false,
        [`fantasy/outgoingTransferRequests/${requester}/${requestKey}/status`]: "declined",
        [`fantasy/outgoingTransferRequests/${requester}/${requestKey}/pending`]: false
      }
    });
    return { id: requestKey, ...transferRequest, status: "declined", pending: false };
  }

  window.UserAppsData = {
    loadReminders,
    addReminder,
    setReminderDone,
    deleteReminder,
    loadProfile,
    saveProfilePicture,
    saveProfileAppearance,
    deleteAccountData,
    loadFantasy,
    buyPlayer,
    investPlayer,
    sellPlayer,
    submitTransferOffer,
    listTransferRequests,
    listOutgoingTransferOffers,
    approveTransferRequest,
    declineTransferRequest
  };
})();
