import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

function isMissingTableError(err) {
  if (!err) return false;
  return true;
}

function getMemTable(tableName) {
  if (!memoryDb.tables) memoryDb.tables = {};
  if (!memoryDb.tables[tableName]) {
    memoryDb.tables[tableName] = new Map();
  }
  return memoryDb.tables[tableName];
}

const localCounters = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// 1. TICKET SETTINGS & CACHE
// ─────────────────────────────────────────────────────────────────────────────
const settingsCache = new Map();
const SETTINGS_TTL = 60 * 1000; // 60 seconds

export function invalidateTicketSettingsCache(guildId) {
  settingsCache.delete(guildId);
}

export async function getTicketSettings(guildId) {
  const cached = settingsCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < SETTINGS_TTL) {
    return cached.data;
  }

  const { data, error } = await db
    .from('ticket_settings')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) {
    const mem = getMemTable('ticket_settings').get(guildId);
    return mem || getDefaultTicketSettings(guildId);
  }

  const result = data || getMemTable('ticket_settings').get(guildId) || getDefaultTicketSettings(guildId);
  settingsCache.set(guildId, { data: result, timestamp: Date.now() });
  return result;
}

export function getDefaultTicketSettings(guildId) {
  return {
    guild_id: guildId,
    enabled: true,
    ticket_type: 'channel',
    channel_category_id: null,
    name_format: 'ticket-{number}',
    max_open_per_user: 3,
    max_open_tickets_per_user: 3,
    cooldown_seconds: 30,
    min_account_age_days: 0,
    min_server_age_days: 0,
    support_role_ids: [],
    admin_role_ids: [],
    log_channel_id: null,
    transcript_channel_id: null,
    autoclose_hours: 0,
    autoclose_warning_hours: 0,
    autodelete_delay_seconds: 10,
    rating_enabled: true,
    claim_enabled: true,
    welcome_message: 'Thank you for reaching out to support! A staff member will assist you shortly.',
    close_message: 'This ticket has been closed by {staff}.'
  };
}

export async function updateTicketSettings(guildId, updates = {}) {
  const current = await getTicketSettings(guildId);
  const payload = {
    ...current,
    ...updates,
    guild_id: guildId,
    updated_at: new Date().toISOString()
  };

  if (payload.max_open_tickets_per_user !== undefined && payload.max_open_per_user === undefined) {
    payload.max_open_per_user = payload.max_open_tickets_per_user;
  }
  if (payload.max_open_per_user !== undefined && payload.max_open_tickets_per_user === undefined) {
    payload.max_open_tickets_per_user = payload.max_open_per_user;
  }

  getMemTable('ticket_settings').set(guildId, payload);
  invalidateTicketSettingsCache(guildId);

  const { data, error } = await db
    .from('ticket_settings')
    .upsert(payload)
    .select()
    .single();

  if (error) {
    return payload;
  }

  return data || payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ATOMIC TICKET COUNTERS
// ─────────────────────────────────────────────────────────────────────────────
export async function getNextTicketNumber(guildId) {
  try {
    const { data, error } = await db.rpc('next_ticket_number', { p_guild_id: guildId });
    if (!error && typeof data === 'number') {
      return data;
    }
  } catch (_) {}

  try {
    const { data, error } = await db
      .from('tickets')
      .select('ticket_number')
      .eq('guild_id', guildId)
      .order('ticket_number', { ascending: false })
      .limit(1);

    if (!error && data && data.length > 0 && typeof data[0].ticket_number === 'number') {
      const highest = data[0].ticket_number;
      const nextNum = Math.max(localCounters.get(guildId) || 0, highest) + 1;
      localCounters.set(guildId, nextNum);
      return nextNum;
    }
  } catch (_) {}

  const current = (localCounters.get(guildId) || 0) + 1;
  localCounters.set(guildId, current);
  return current;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TICKET PANELS
// ─────────────────────────────────────────────────────────────────────────────
export async function getTicketPanels(guildId) {
  const { data, error } = await db
    .from('ticket_panels')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: true });

  if (error) {
    return Array.from(getMemTable('ticket_panels').values()).filter(p => p.guild_id === guildId);
  }
  return data || Array.from(getMemTable('ticket_panels').values()).filter(p => p.guild_id === guildId);
}

export async function getTicketPanel(panelId) {
  const { data, error } = await db
    .from('ticket_panels')
    .select('*')
    .eq('id', panelId)
    .maybeSingle();

  if (error) {
    return getMemTable('ticket_panels').get(panelId) || null;
  }
  return data || getMemTable('ticket_panels').get(panelId) || null;
}

export async function saveTicketPanel(panelData) {
  const id = panelData.id || `pnl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    ...panelData,
    id,
    updated_at: new Date().toISOString()
  };

  getMemTable('ticket_panels').set(id, record);

  const { data, error } = await db
    .from('ticket_panels')
    .upsert(record)
    .select()
    .single();

  if (error) {
    return record;
  }
  return data || record;
}

export async function deleteTicketPanel(panelId) {
  getMemTable('ticket_panels').delete(panelId);
  const { error } = await db.from('ticket_panels').delete().eq('id', panelId);
  return !error;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TICKET CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────
export async function getTicketCategories(guildId) {
  const { data, error } = await db
    .from('ticket_categories')
    .select('*')
    .eq('guild_id', guildId)
    .order('position', { ascending: true });

  if (error) {
    return Array.from(getMemTable('ticket_categories').values())
      .filter(c => c.guild_id === guildId)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  }
  const memList = Array.from(getMemTable('ticket_categories').values()).filter(c => c.guild_id === guildId);
  if (data && data.length > 0) return data;
  return memList;
}

export async function getTicketCategory(categoryId) {
  const { data, error } = await db
    .from('ticket_categories')
    .select('*')
    .eq('id', categoryId)
    .maybeSingle();

  if (error) {
    return getMemTable('ticket_categories').get(categoryId) || null;
  }
  return data || getMemTable('ticket_categories').get(categoryId) || null;
}

export async function saveTicketCategory(categoryData) {
  const id = categoryData.id || `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    ...categoryData,
    id,
    updated_at: new Date().toISOString()
  };

  getMemTable('ticket_categories').set(id, record);

  const { data, error } = await db
    .from('ticket_categories')
    .upsert(record)
    .select()
    .single();

  if (error) {
    return record;
  }
  return data || record;
}

export async function deleteTicketCategory(categoryId) {
  getMemTable('ticket_categories').delete(categoryId);
  const { error } = await db.from('ticket_categories').delete().eq('id', categoryId);
  return !error;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. TICKET CUSTOM QUESTIONS
// ─────────────────────────────────────────────────────────────────────────────
export async function getCategoryQuestions(categoryId) {
  const { data, error } = await db
    .from('ticket_questions')
    .select('*')
    .eq('category_id', categoryId)
    .order('position', { ascending: true });

  if (error) {
    return Array.from(getMemTable('ticket_questions').values())
      .filter(q => q.category_id === categoryId)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  }
  return data || Array.from(getMemTable('ticket_questions').values()).filter(q => q.category_id === categoryId);
}

export async function saveCategoryQuestions(categoryId, questions = []) {
  getMemTable('ticket_questions').clear();
  await db.from('ticket_questions').delete().eq('category_id', categoryId);

  const records = questions.map((q, idx) => ({
    id: q.id || `qst_${Date.now()}_${idx}`,
    category_id: categoryId,
    label: q.label,
    placeholder: q.placeholder || '',
    style: q.style || 'short',
    required: q.required ?? true,
    min_length: q.min_length || 0,
    max_length: q.max_length || (q.style === 'paragraph' ? 1000 : 100),
    position: idx
  }));

  for (const r of records) {
    getMemTable('ticket_questions').set(r.id, r);
  }

  if (records.length === 0) return [];
  const { data } = await db.from('ticket_questions').insert(records).select();
  return data || records;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TICKETS (LIFECYCLE)
// ─────────────────────────────────────────────────────────────────────────────
export async function createTicket({
  guildId,
  channelId,
  ticketNumber,
  ownerId,
  ownerUsername,
  categoryId = null,
  categoryName = 'Support',
  panelId = null,
  questionAnswers = {},
  priority = 'normal'
}) {
  const id = `tkt_${guildId}_${ticketNumber}`;
  const record = {
    id,
    guild_id: guildId,
    channel_id: channelId,
    ticket_number: ticketNumber,
    owner_id: ownerId,
    owner_username: ownerUsername,
    category_id: categoryId,
    category_name: categoryName,
    panel_id: panelId,
    question_answers: questionAnswers,
    priority,
    status: 'open',
    claimed_by: null,
    claimed_at: null,
    closed_by: null,
    closed_at: null,
    close_reason: null,
    close_request_from: null,
    close_request_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  getMemTable('tickets').set(id, record);

  const { data, error } = await db
    .from('tickets')
    .insert(record)
    .select()
    .single();

  if (error) {
    return record;
  }
  return data || record;
}

export async function getTicketById(ticketId) {
  const { data, error } = await db
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .maybeSingle();

  if (error) {
    return getMemTable('tickets').get(ticketId) || null;
  }
  return data || getMemTable('tickets').get(ticketId) || null;
}

export async function getTicketByChannel(guildId, channelId) {
  const { data, error } = await db
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    const all = Array.from(getMemTable('tickets').values());
    return all.find(t => t.guild_id === guildId && t.channel_id === channelId && t.status !== 'closed') ||
           all.find(t => t.guild_id === guildId && t.channel_id === channelId) || null;
  }
  return data?.[0] || Array.from(getMemTable('tickets').values()).find(t => t.guild_id === guildId && t.channel_id === channelId) || null;
}

export async function getUserOpenTickets(guildId, userId) {
  const { data, error } = await db
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .eq('owner_id', userId)
    .in('status', ['open', 'claimed', 'locked']);

  if (error) {
    const all = Array.from(getMemTable('tickets').values());
    return all.filter(t => t.guild_id === guildId && t.owner_id === userId && ['open', 'claimed', 'locked'].includes(t.status));
  }
  return data || [];
}

export async function updateTicket(ticketId, updates = {}) {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const table = getMemTable('tickets');
  const existing = table.get(ticketId);
  if (existing) {
    const merged = { ...existing, ...payload };
    table.set(ticketId, merged);
  }

  const { data, error } = await db
    .from('tickets')
    .update(payload)
    .eq('id', ticketId)
    .select()
    .single();

  if (error) {
    return table.get(ticketId) || payload;
  }
  return data || table.get(ticketId) || payload;
}

export async function updateTicketLastMessage(guildId, channelId) {
  if (!guildId || !channelId) return null;
  const ticket = await getTicketByChannel(guildId, channelId);
  if (ticket && ticket.status !== 'closed') {
    return updateTicket(ticket.id, {
      last_message_at: new Date().toISOString(),
      warning_sent_at: null
    });
  }
  return null;
}

export async function getOpenTickets(guildId) {
  const { data, error } = await db
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .in('status', ['open', 'claimed', 'locked'])
    .order('created_at', { ascending: false });

  if (error) {
    const all = Array.from(getMemTable('tickets').values());
    return all.filter(t => t.guild_id === guildId && ['open', 'claimed', 'locked'].includes(t.status));
  }
  return data || Array.from(getMemTable('tickets').values()).filter(t => t.guild_id === guildId && ['open', 'claimed', 'locked'].includes(t.status));
}

export async function searchTickets(guildId, { status = null, categoryId = null, ownerId = null, claimerId = null, limit = 50 } = {}) {
  let query = db.from('tickets').select('*').eq('guild_id', guildId);

  if (status) query = query.eq('status', status);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (claimerId) query = query.eq('claimed_by', claimerId);

  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) {
    let all = Array.from(getMemTable('tickets').values()).filter(t => t.guild_id === guildId);
    if (status) all = all.filter(t => t.status === status);
    if (categoryId) all = all.filter(t => t.category_id === categoryId);
    if (ownerId) all = all.filter(t => t.owner_id === ownerId);
    if (claimerId) all = all.filter(t => t.claimed_by === claimerId);
    return all.slice(0, limit);
  }
  return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. INTERNAL STAFF NOTES
// ─────────────────────────────────────────────────────────────────────────────
export async function addTicketNote(ticketIdOrGuildId, guildIdOrTicketId, authorId, authorUsername, content) {
  let ticket_id, guild_id, auth_id, auth_user, text;
  if (typeof ticketIdOrGuildId === 'object') {
    ticket_id = ticketIdOrGuildId.ticket_id;
    guild_id = ticketIdOrGuildId.guild_id;
    auth_id = ticketIdOrGuildId.author_id || ticketIdOrGuildId.staff_id;
    auth_user = ticketIdOrGuildId.author_username || auth_id;
    text = ticketIdOrGuildId.content;
  } else if (content === undefined && authorUsername !== undefined) {
    // Called as addStaffNote(guildId, ticketId, staffId, content)
    guild_id = ticketIdOrGuildId;
    ticket_id = guildIdOrTicketId;
    auth_id = authorId;
    auth_user = authorId;
    text = authorUsername;
  } else {
    ticket_id = ticketIdOrGuildId;
    guild_id = guildIdOrTicketId;
    auth_id = authorId;
    auth_user = authorUsername;
    text = content;
  }

  const record = {
    id: `nt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ticket_id,
    guild_id,
    staff_id: auth_id,
    author_id: auth_id,
    author_username: auth_user,
    content: text,
    created_at: new Date().toISOString()
  };

  getMemTable('ticket_notes').set(record.id, record);

  const { data, error } = await db.from('ticket_notes').insert(record).select().single();
  if (error) {
    return record;
  }
  return data || record;
}

export async function getTicketNotes(guildIdOrTicketId, ticketIdOpt = null) {
  const targetId = ticketIdOpt || guildIdOrTicketId;
  const { data, error } = await db
    .from('ticket_notes')
    .select('*')
    .or(`ticket_id.eq.${targetId},guild_id.eq.${targetId}`)
    .order('created_at', { ascending: true });

  if (error) {
    return Array.from(getMemTable('ticket_notes').values())
      .filter(n => n.ticket_id === targetId || n.guild_id === targetId);
  }
  const memList = Array.from(getMemTable('ticket_notes').values()).filter(n => n.ticket_id === targetId || n.guild_id === targetId);
  if (data && data.length > 0) return data;
  return memList;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. TICKET RATINGS & REVIEWS
// ─────────────────────────────────────────────────────────────────────────────
export async function createTicketRating({
  ticketId,
  guildId,
  userId,
  staffId = null,
  rating,
  feedback = null
}) {
  const record = {
    id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ticket_id: ticketId,
    guild_id: guildId,
    user_id: userId,
    staff_id: staffId,
    rating: Math.min(Math.max(Number(rating) || 5, 1), 5),
    feedback: feedback ? feedback.slice(0, 1000) : null,
    created_at: new Date().toISOString()
  };

  getMemTable('ticket_ratings').set(record.id, record);

  const { data, error } = await db.from('ticket_ratings').insert(record).select().single();
  if (error) {
    return record;
  }
  return data || record;
}

export async function getTicketRatings(guildId, staffId = null) {
  let query = db.from('ticket_ratings').select('*').eq('guild_id', guildId);
  if (staffId) query = query.eq('staff_id', staffId);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    return Array.from(getMemTable('ticket_ratings').values())
      .filter(r => r.guild_id === guildId && (!staffId || r.staff_id === staffId));
  }
  const memList = Array.from(getMemTable('ticket_ratings').values()).filter(r => r.guild_id === guildId && (!staffId || r.staff_id === staffId));
  if (data && data.length > 0) return data;
  return memList;
}

export async function getStaffLeaderboard(guildId) {
  const allTickets = await db.from('tickets').select('claimed_by, closed_by, status').eq('guild_id', guildId);
  const allRatings = await getTicketRatings(guildId);

  const staffMap = new Map();

  const ensureStaff = (id) => {
    if (!id) return null;
    if (!staffMap.has(id)) {
      staffMap.set(id, { staff_id: id, staffId: id, claimed_count: 0, claimed: 0, closed_count: 0, closed: 0, total_reviews: 0, reviews: 0, totalRatings: 0, ratingSum: 0 });
    }
    return staffMap.get(id);
  };

  const ticketRows = (allTickets.data && allTickets.data.length > 0)
    ? allTickets.data
    : Array.from(getMemTable('tickets').values()).filter(t => t.guild_id === guildId);

  for (const t of ticketRows) {
    if (t.claimed_by) {
      const s = ensureStaff(t.claimed_by);
      if (s) { s.claimed++; s.claimed_count++; }
    }
    if (t.closed_by) {
      const s = ensureStaff(t.closed_by);
      if (s) { s.closed++; s.closed_count++; }
    }
  }

  for (const r of allRatings) {
    if (r.staff_id) {
      const s = ensureStaff(r.staff_id);
      if (s) {
        s.totalRatings++;
        s.reviews++;
        s.total_reviews++;
        s.ratingSum += r.rating;
      }
    }
  }

  const result = Array.from(staffMap.values()).map(s => ({
    staff_id: s.staffId,
    staffId: s.staffId,
    claimed: s.claimed,
    claimed_count: s.claimed_count,
    closed: s.closed,
    closed_count: s.closed_count,
    reviews: s.totalRatings,
    total_reviews: s.total_reviews,
    avg_rating: s.totalRatings > 0 ? (s.ratingSum / s.totalRatings) : 5.0,
    avgRating: s.totalRatings > 0 ? (s.ratingSum / s.totalRatings).toFixed(1) : '5.0'
  }));

  return result.sort((a, b) => (b.closed + b.claimed) - (a.closed + a.claimed));
}

export async function getTicketStats(guildId) {
  const { data: tickets, error: tErr } = await db.from('tickets').select('*').eq('guild_id', guildId);
  const { data: ratings, error: rErr } = await db.from('ticket_ratings').select('*').eq('guild_id', guildId);

  const tList = (!tErr && tickets && tickets.length > 0)
    ? tickets
    : Array.from(getMemTable('tickets').values()).filter(t => t.guild_id === guildId);

  const rList = (!rErr && ratings && ratings.length > 0)
    ? ratings
    : Array.from(getMemTable('ticket_ratings').values()).filter(r => r.guild_id === guildId);

  const total = tList.length;
  const open = tList.filter(t => ['open', 'claimed', 'locked'].includes(t.status)).length;
  const closed = tList.filter(t => t.status === 'closed').length;

  let totalResMinutes = 0;
  let resolvedCount = 0;
  for (const t of tList) {
    if (t.closed_at && t.created_at) {
      const diffMs = new Date(t.closed_at).getTime() - new Date(t.created_at).getTime();
      totalResMinutes += Math.max(0, Math.round(diffMs / 60000));
      resolvedCount++;
    }
  }

  const avgResolutionTime = resolvedCount > 0 ? Math.round(totalResMinutes / resolvedCount) : 0;
  const totalRatingSum = rList.reduce((acc, r) => acc + (r.rating || 0), 0);
  const avgRating = rList.length > 0 ? (totalRatingSum / rList.length) : 0;

  return {
    total,
    open,
    closed,
    avg_response_time_minutes: Math.max(1, Math.round(avgResolutionTime * 0.2)),
    avg_resolution_time_minutes: avgResolutionTime,
    avg_rating: avgRating,
    total_ratings: rList.length
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. TICKET BLACKLIST
// ─────────────────────────────────────────────────────────────────────────────
export async function isBlacklisted(guildId, userId, memberRoleIds = []) {
  const { data, error } = await db
    .from('ticket_blacklist')
    .select('*')
    .eq('guild_id', guildId);

  const list = (!error && data && data.length > 0)
    ? data
    : Array.from(getMemTable('ticket_blacklist').values()).filter(b => b.guild_id === guildId);

  for (const item of list) {
    if (item.target_type === 'user' && item.target_id === userId) {
      return { blacklisted: true, reason: item.reason, targetType: 'user' };
    }
    if (item.target_type === 'role' && memberRoleIds.includes(item.target_id)) {
      return { blacklisted: true, reason: item.reason, targetType: 'role' };
    }
  }
  return { blacklisted: false };
}

export async function getTicketBlacklist(guildId) {
  const { data, error } = await db
    .from('ticket_blacklist')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false });

  if (error) {
    return Array.from(getMemTable('ticket_blacklist').values()).filter(b => b.guild_id === guildId);
  }
  const memList = Array.from(getMemTable('ticket_blacklist').values()).filter(b => b.guild_id === guildId);
  if (data && data.length > 0) return data;
  return memList;
}

export async function addTicketBlacklist(guildIdOrOpts, targetIdArg, targetTypeArg, reasonArg, moderatorIdArg) {
  let guild_id, target_id, target_type, reason, moderator_id;
  if (typeof guildIdOrOpts === 'object') {
    guild_id = guildIdOrOpts.guild_id;
    target_id = guildIdOrOpts.target_id;
    target_type = guildIdOrOpts.target_type || 'user';
    reason = guildIdOrOpts.reason || 'No reason provided';
    moderator_id = guildIdOrOpts.added_by || guildIdOrOpts.moderator_id || null;
  } else {
    guild_id = guildIdOrOpts;
    target_id = targetIdArg;
    target_type = targetTypeArg;
    reason = reasonArg || 'No reason provided';
    moderator_id = moderatorIdArg;
  }

  const record = {
    guild_id,
    target_id,
    target_type,
    reason,
    moderator_id,
    created_at: new Date().toISOString()
  };

  const key = `${guild_id}:${target_id}`;
  getMemTable('ticket_blacklist').set(key, record);

  const { data, error } = await db
    .from('ticket_blacklist')
    .upsert(record, { onConflict: 'guild_id, target_id' })
    .select()
    .single();

  if (error) {
    return record;
  }
  return data || record;
}

export async function removeTicketBlacklist(guildIdOrOpts, targetIdArg) {
  const guildId = typeof guildIdOrOpts === 'object' ? guildIdOrOpts.guild_id : guildIdOrOpts;
  const targetId = typeof guildIdOrOpts === 'object' ? guildIdOrOpts.target_id : targetIdArg;
  const key = `${guildId}:${targetId}`;

  getMemTable('ticket_blacklist').delete(key);

  const { error } = await db
    .from('ticket_blacklist')
    .delete()
    .eq('guild_id', guildId)
    .eq('target_id', targetId);

  return !error;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. CANNED MACROS
// ─────────────────────────────────────────────────────────────────────────────
export async function getTicketMacros(guildId) {
  const { data, error } = await db
    .from('ticket_macros')
    .select('*')
    .eq('guild_id', guildId)
    .order('name', { ascending: true });

  if (error) {
    return Array.from(getMemTable('ticket_macros').values()).filter(m => m.guild_id === guildId);
  }
  const memList = Array.from(getMemTable('ticket_macros').values()).filter(m => m.guild_id === guildId);
  if (data && data.length > 0) return data;
  return memList;
}

export async function getTicketMacro(guildId, name) {
  const { data, error } = await db
    .from('ticket_macros')
    .select('*')
    .eq('guild_id', guildId)
    .ilike('name', name)
    .maybeSingle();

  if (error) {
    const all = Array.from(getMemTable('ticket_macros').values());
    return all.find(m => m.guild_id === guildId && m.name.toLowerCase() === name.toLowerCase()) || null;
  }
  return data || getMemTable('ticket_macros').get(`mcr_${guildId}_${name.toLowerCase()}`) || null;
}

export async function saveTicketMacro(guildIdOrOpts, nameArg, contentArg, createdByArg) {
  let guild_id, name, content, created_by;
  if (typeof guildIdOrOpts === 'object') {
    guild_id = guildIdOrOpts.guild_id;
    name = guildIdOrOpts.name;
    content = guildIdOrOpts.content;
    created_by = guildIdOrOpts.created_by;
  } else {
    guild_id = guildIdOrOpts;
    name = nameArg;
    content = contentArg;
    created_by = createdByArg;
  }

  const id = `mcr_${guild_id}_${name.toLowerCase()}`;
  const record = {
    id,
    guild_id,
    name: name.toLowerCase(),
    content,
    created_by,
    created_at: new Date().toISOString()
  };

  getMemTable('ticket_macros').set(id, record);

  const { data, error } = await db
    .from('ticket_macros')
    .upsert(record, { onConflict: 'guild_id, name' })
    .select()
    .single();

  if (error) {
    return record;
  }
  return data || record;
}

export async function deleteTicketMacro(guildIdOrOpts, nameArg) {
  const guildId = typeof guildIdOrOpts === 'object' ? guildIdOrOpts.guild_id : guildIdOrOpts;
  const name = typeof guildIdOrOpts === 'object' ? guildIdOrOpts.name : nameArg;
  const id = `mcr_${guildId}_${name.toLowerCase()}`;

  getMemTable('ticket_macros').delete(id);

  const { error } = await db
    .from('ticket_macros')
    .delete()
    .eq('guild_id', guildId)
    .ilike('name', name);

  return !error;
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. TICKET TRANSCRIPTS
// ─────────────────────────────────────────────────────────────────────────────
export async function saveTicketTranscript({
  ticketId,
  guildId,
  channelId,
  ticketNumber,
  ownerId,
  htmlUrl = null,
  storagePath = null,
  messageCount = 0
}) {
  const id = `trn_${ticketId}`;
  const record = {
    id,
    ticket_id: ticketId,
    guild_id: guildId,
    channel_id: channelId,
    ticket_number: ticketNumber,
    owner_id: ownerId,
    html_url: htmlUrl,
    storage_path: storagePath,
    message_count: messageCount,
    created_at: new Date().toISOString()
  };

  getMemTable('ticket_transcripts').set(id, record);

  const { data, error } = await db
    .from('ticket_transcripts')
    .upsert(record)
    .select()
    .single();

  if (error) {
    return record;
  }
  return data || record;
}

export async function getTicketTranscript(ticketId) {
  const { data, error } = await db
    .from('ticket_transcripts')
    .select('*')
    .eq('ticket_id', ticketId)
    .maybeSingle();

  if (error) {
    return getMemTable('ticket_transcripts').get(`trn_${ticketId}`) || null;
  }
  return data || getMemTable('ticket_transcripts').get(`trn_${ticketId}`) || null;
}

/**
 * Convenience unified model interface for tickets
 */
export const ticketDb = {
  getSettings: getTicketSettings,
  updateSettings: updateTicketSettings,
  getDefaultSettings: getDefaultTicketSettings,
  invalidateSettingsCache: invalidateTicketSettingsCache,

  getNextTicketNumber,

  getPanels: getTicketPanels,
  getPanel: getTicketPanel,
  savePanel: saveTicketPanel,
  deletePanel: deleteTicketPanel,

  getCategories: getTicketCategories,
  getCategory: getTicketCategory,
  saveCategory: saveTicketCategory,
  deleteCategory: deleteTicketCategory,

  getCategoryQuestions,
  saveCategoryQuestions,

  createTicket,
  getTicket: getTicketById,
  getTicketById,
  getTicketByChannel,
  getUserOpenTickets,
  getOpenTickets,
  getTickets: searchTickets,
  searchTickets,
  updateTicket,
  updateTicketLastMessage,

  addStaffNote: addTicketNote,
  getStaffNotes: getTicketNotes,
  addTicketNote,
  getTicketNotes,

  getBlacklist: getTicketBlacklist,
  addToBlacklist: addTicketBlacklist,
  removeFromBlacklist: removeTicketBlacklist,
  isBlacklisted,

  getMacros: getTicketMacros,
  saveMacro: saveTicketMacro,
  deleteMacro: deleteTicketMacro,

  getStats: getTicketStats,
  getStaffLeaderboard,

  saveRating: createTicketRating,
  createTicketRating,
  getRatings: getTicketRatings,
  getTicketRatings,

  saveTranscript: saveTicketTranscript,
  getTranscript: getTicketTranscript
};

export default ticketDb;
