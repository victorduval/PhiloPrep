const { getStore } = require("@netlify/blobs");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function getUser(event) {
  const u = event && event.clientContext && event.clientContext.user ? event.clientContext.user : null;
  if (!u || !u.sub) return null;
  return u;
}

async function readUsers(store) {
  const users = (await store.get("users", { type: "json" })) || {};
  return users && typeof users === "object" ? users : {};
}

async function writeUsers(store, users) {
  await store.setJSON("users", users);
}

function safeProfile(input) {
  const p = input && typeof input === "object" ? input : {};
  return {
    displayName: String(p.displayName || "Utilisateur"),
    xp: Math.max(0, Math.floor(Number(p.xp) || 0)),
    level: Math.max(1, Math.floor(Number(p.level) || 1)),
    badge: String(p.badge || "Connecteur Pro"),
    class: {
      school: String((p.class && p.class.school) || ""),
      className: String((p.class && p.class.className) || ""),
    },
    friendCode: String(p.friendCode || ""),
    privacy: {
      searchable: p.privacy ? p.privacy.searchable !== false : true,
      showLastActivity: p.privacy ? p.privacy.showLastActivity !== false : true,
      showNotions: p.privacy ? p.privacy.showNotions !== false : true,
    },
  };
}

function normalizeUser(id, user = {}) {
  return {
    id,
    displayName: user.displayName || "Utilisateur",
    xp: Math.max(0, Math.floor(Number(user.xp) || 0)),
    level: Math.max(1, Math.floor(Number(user.level) || 1)),
    badge: user.badge || "Connecteur Pro",
    class: user.class || { school: "", className: "" },
    friendCode: user.friendCode || "",
    privacy: user.privacy || { searchable: true, showLastActivity: true, showNotions: true },
    friends: Array.isArray(user.friends) ? user.friends : [],
    friendRequests: {
      pending: user.friendRequests && Array.isArray(user.friendRequests.pending) ? user.friendRequests.pending : [],
      sent: user.friendRequests && Array.isArray(user.friendRequests.sent) ? user.friendRequests.sent : [],
    },
    lastActivity: Math.max(0, Math.floor(Number(user.lastActivity) || 0)),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const user = getUser(event);
  if (!user) return json(401, { error: "Unauthorized" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }

  const action = String(body.action || "");
  const store = getStore("philoprep-social");
  const users = await readUsers(store);
  const meId = user.sub;
  const current = normalizeUser(meId, users[meId] || {});
  users[meId] = current;

  if (action === "syncProfile") {
    const p = safeProfile(body.profile || {});
    const merged = normalizeUser(meId, {
      ...current,
      ...p,
      class: p.class,
      privacy: p.privacy,
      lastActivity: Date.now(),
      friendCode: p.friendCode || current.friendCode || String(Math.floor(100000 + Math.random() * 900000)),
    });
    users[meId] = merged;
    await writeUsers(store, users);
    return json(200, { ok: true, me: merged });
  }

  if (action === "searchUsers") {
    const q = String(body.query || "").toLowerCase().trim();
    const all = Object.entries(users)
      .filter(([id, u]) => id !== meId && u && (!u.privacy || u.privacy.searchable !== false))
      .map(([id, u]) => normalizeUser(id, u))
      .filter((u) => !q || u.displayName.toLowerCase().includes(q))
      .slice(0, 20)
      .map((u) => ({ id: u.id, username: u.displayName, level: u.level, xp: u.xp, badge: u.badge, friendCode: u.friendCode }));
    return json(200, { results: all });
  }

  if (action === "addFriend") {
    const targetId = String(body.targetId || "");
    const targetCode = String(body.friendCode || "");
    let target = null;
    if (targetId && users[targetId]) target = normalizeUser(targetId, users[targetId]);
    if (!target && targetCode) {
      const found = Object.entries(users).find(([id, u]) => id !== meId && String((u && u.friendCode) || "") === targetCode);
      if (found) target = normalizeUser(found[0], found[1]);
    }
    if (!target || target.id === meId) return json(404, { error: "Target not found" });
    const me = normalizeUser(meId, users[meId]);
    if (me.friends.includes(target.id)) return json(200, { ok: true, already: true });
    if (!target.friendRequests.pending.includes(meId)) target.friendRequests.pending.push(meId);
    if (!me.friendRequests.sent.includes(target.id)) me.friendRequests.sent.push(target.id);
    users[meId] = me;
    users[target.id] = target;
    await writeUsers(store, users);
    return json(200, { ok: true });
  }

  if (action === "respondFriendRequest") {
    const requesterId = String(body.requesterId || "");
    const accept = !!body.accept;
    const me = normalizeUser(meId, users[meId]);
    const requester = users[requesterId] ? normalizeUser(requesterId, users[requesterId]) : null;
    if (!requester) return json(404, { error: "Requester not found" });
    me.friendRequests.pending = me.friendRequests.pending.filter((id) => id !== requesterId);
    requester.friendRequests.sent = requester.friendRequests.sent.filter((id) => id !== meId);
    if (accept) {
      if (!me.friends.includes(requesterId)) me.friends.push(requesterId);
      if (!requester.friends.includes(meId)) requester.friends.push(meId);
    }
    users[meId] = me;
    users[requesterId] = requester;
    await writeUsers(store, users);
    return json(200, { ok: true });
  }

  if (action === "removeFriend") {
    const targetId = String(body.targetId || "");
    const me = normalizeUser(meId, users[meId]);
    me.friends = me.friends.filter((id) => id !== targetId);
    users[meId] = me;
    if (users[targetId]) {
      const t = normalizeUser(targetId, users[targetId]);
      t.friends = t.friends.filter((id) => id !== meId);
      users[targetId] = t;
    }
    await writeUsers(store, users);
    return json(200, { ok: true });
  }

  if (action === "setPrivacy") {
    const me = normalizeUser(meId, users[meId]);
    const p = body.privacy || {};
    me.privacy = {
      searchable: p.searchable !== false,
      showLastActivity: p.showLastActivity !== false,
      showNotions: p.showNotions !== false,
    };
    users[meId] = me;
    await writeUsers(store, users);
    return json(200, { ok: true, privacy: me.privacy });
  }

  if (action === "setClass") {
    const me = normalizeUser(meId, users[meId]);
    me.class = {
      school: String((body.class && body.class.school) || ""),
      className: String((body.class && body.class.className) || ""),
    };
    users[meId] = me;
    await writeUsers(store, users);
    return json(200, { ok: true, class: me.class });
  }

  if (action === "getSocialData") {
    const me = normalizeUser(meId, users[meId]);
    const friends = me.friends.map((id) => users[id] ? normalizeUser(id, users[id]) : null).filter(Boolean);
    const pending = me.friendRequests.pending.map((id) => users[id] ? normalizeUser(id, users[id]) : null).filter(Boolean);

    const globalRows = Object.entries(users)
      .map(([id, u]) => normalizeUser(id, u))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 100)
      .map((u) => ({ id: u.id, username: u.displayName, level: u.level, xp: u.xp, badge: u.badge }));

    const classRows = globalRows.filter((r) => {
      const u = users[r.id];
      return u && u.class && me.class && u.class.school === me.class.school && u.class.className === me.class.className && me.class.school && me.class.className;
    });

    return json(200, {
      me: { ...me, username: me.displayName },
      friends: friends.map((u) => ({ id: u.id, username: u.displayName, level: u.level, xp: u.xp, badge: u.badge, lastActivity: u.lastActivity, friendCode: u.friendCode })),
      pendingRequests: pending.map((u) => ({ id: u.id, username: u.displayName, level: u.level, xp: u.xp, badge: u.badge })),
      leaderboards: { global: globalRows, class: classRows },
    });
  }

  return json(400, { error: "Unknown action" });
};

