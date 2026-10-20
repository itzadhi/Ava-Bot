import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

function isMissingTableError(err) {
  return err && (err.code === 'PGRST205' || err.code === '42P01' || String(err.message).includes('schema cache'));
}

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
    if (isMissingTableError(error)) {
      const mem = memoryDb.from('ticket_settings').tables?.ticket_settings?.get(guildId);
      return mem || getDefaultTicketSettings(guildId);
    }
    logger.warn({ err: error, guildId }, 'Error fetching ticket_settings, using defaults');
    return getDefaultTicketSettings(guildId);
  }

  const result = data || getDefaultTicketSettings(guildId);
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

  const { data, error } = await db
    .from('ticket_settings')
    .upsert(payload)
    .select()
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      memoryDb.from('ticket_settings').tables?.ticket_settings?.set(guildId, payload);
      invalidateTicketSettingsCache(guildId);
      return payload;
    }
    logger.error({ err: error, guildId }, 'Failed to update ticket_settings');
    throw error;
  }

  invalidateTicketSettingsCache(guildId);
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

  // Fallback counter logic via tickets table count or counter row
  try {
    const { data } = await db
      .from('tickets')
      .select('ticket_number')
      .eq('guild_id', guildId)
      .order('ticket_number', { ascending: false })
      .limit(1);

    const highest = data?.[0]?.ticket_number || 0;
    return highest + 1;
  } catch {
    return 1;
  }
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
    if (isMissingTableError(error)) {
      return Array.from(memoryDb.from('ticket_panels').tables?.ticket_panels?.values() || [])
        .filter(p => p.guild_id === guildId);
    }
    return [];
  }
  return data || [];
}

export async function getTicketPanel(panelId) {
  const { data, error } = await db
    .from('ticket_panels')
    .select('*')
    .eq('id', panelId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return memoryDb.from('ticket_panels').tables?.ticket_panels?.get(panelId) || null;
    }
    return null;
  }
  return data || null;
}

export async function saveTicketPanel(panelData) {
  const id = panelData.id || `pnl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    ...panelData,
    id,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('ticket_panels')
    .upsert(record)
    .select()
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      memoryDb.from('ticket_panels').tables?.ticket_panels?.set(id, record);
      return record;
    }
    throw error;
  }
  return data || record;
}

export async function deleteTicketPanel(panelId) {
  const { error } = await db.from('ticket_panels').delete().eq('id', panelId);
  if (error && isMissingTableError(error)) {
    memoryDb.from('ticket_panels').tables?.ticket_panels?.delete(panelId);
    return true;
  }
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
    if (isMissingTableError(error)) {
      return Array.from(memoryDb.from('ticket_categories').tables?.ticket_categories?.values() || [])
        .filter(c => c.guild_id === guildId)
        .sort((a, b) => (a.position || 0) - (b.position || 0));
    }
    return [];
  }
  return data || [];
}

export async function getTicketCategory(categoryId) {
  const { data, error } = await db
    .from('ticket_categories')
    .select('*')
    .eq('id', categoryId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return memoryDb.from('ticket_categories').tables?.ticket_categories?.get(categoryId) || null;
    }
    return null;
  }
  return data || null;
}

export async function saveTicketCategory(categoryData) {
  const id = categoryData.id || `cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    ...categoryData,
    id,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('ticket_categories')
    .upsert(record)
    .select()
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      memoryDb.from('ticket_categories').tables?.ticket_categories?.set(id, record);
      return record;
    }
    throw error;
  }
  return data || record;
}

export async function deleteTicketCategory(categoryId) {
  const { error } = await db.from('ticket_categories').delete().eq('id', categoryId);
  if (error && isMissingTableError(error)) {
    memoryDb.from('ticket_categories').tables?.ticket_categories?.delete(categoryId);
    return true;
  }
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
    if (isMissingTableError(error)) {
      return Array.from(memoryDb.from('ticket_questions').tables?.ticket_questions?.values() || [])
        .filter(q => q.category_id === categoryId)
        .sort((a, b) => (a.position || 0) - (b.position || 0));
    }
    return [];
  }
  return data || [];
}

export async function saveCategoryQuestions(categoryId, guildId, questions = []) {
  // Clear old and insert new up to 5 questions
  await db.from('ticket_questions').delete().eq('category_id', categoryId).catch(() => {});

  const inserted = [];
  for (let i = 0; i < Math.min(questions.length, 5); i++) {
    const q = questions[i];
    const id = q.id || `q_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
    const record = {
      id,
      category_id: categoryId,
      guild_id: guildId,
      label: q.label.slice(0, 45),
      placeholder: q.placeholder ? q.placeholder.slice(0, 100) : null,
      style: q.style === 'short' ? 'short' : 'paragraph',
      required: q.required !== false,
      position: i,
      min_length: q.min_length || 0,
      max_length: q.max_length || 1000
    };

    await db.from('ticket_questions').insert(record).catch(() => {
      memoryDb.from('ticket_questions').tables?.ticket_questions?.set(id, record);
    });
    inserted.push(record);
  }
  return inserted;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TICKETS CORE
// ─────────────────────────────────────────────────────────────────────────────
export async function createTicket({
  guildId,
  channelId,
  ticketNumber,
  categoryId = null,
  categoryName,
  ownerId,
  ownerUsername,
  controlMessageId = null,
  questionAnswers = {}
}) {
  const id = `tkt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    id,
    guild_id: guildId,
    channel_id: channelId,
    ticket_number: ticketNumber,
    category_id: categoryId,
    category_name: categoryName,
    owner_id: ownerId,
    owner_username: ownerUsername,
    status: 'open',
    priority: 'normal',
    claimed_by: null,
    claimed_at: null,
    closed_by: null,
    closed_at: null,
    close_reason: null,
    close_request_from: null,
    close_request_at: null,
    control_message_id: controlMessageId,
    question_answers: questionAnswers,
    transcript_url: null,
    rating: null,
    last_message_at: new Date().toISOString(),
    warning_sent_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('tickets')
    .insert(record)
    .select()
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      memoryDb.from('tickets').tables?.tickets?.set(id, record);
      return record;
    }
    logger.error({ err: error, guildId, channelId }, 'Failed to insert ticket');
    throw error;
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
    if (isMissingTableError(error)) {
      return memoryDb.from('tickets').tables?.tickets?.get(ticketId) || null;
    }
    return null;
  }
  return data || null;
}

export async function getTicketByChannel(channelId) {
  const { data, error } = await db
    .from('tickets')
    .select('*')
    .eq('channel_id', channelId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const all = Array.from(memoryDb.from('tickets').tables?.tickets?.values() || []);
      return all.find(t => t.channel_id === channelId) || null;
    }
    return null;
  }
  return data || null;
}

export async function getUserOpenTickets(guildId, userId, categoryId = null) {
  let query = db
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .eq('owner_id', userId)
    .in('status', ['open', 'claimed', 'locked']);

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      const all = Array.from(memoryDb.from('tickets').tables?.tickets?.values() || []);
      return all.filter(t => 
        t.guild_id === guildId &&
        t.owner_id === userId &&
        ['open', 'claimed', 'locked'].includes(t.status) &&
        (!categoryId || t.category_id === categoryId)
      );
    }
    return [];
  }
  return data || [];
}

export async function updateTicket(ticketId, updates = {}) {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('tickets')
    .update(payload)
    .eq('id', ticketId)
    .select()
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      const table = memoryDb.from('tickets').tables?.tickets;
      const existing = table?.get(ticketId);
      if (existing) {
        const merged = { ...existing, ...payload };
        table.set(ticketId, merged);
        return merged;
      }
      return null;
    }
    logger.error({ err: error, ticketId }, 'Failed to update ticket');
    throw error;
  }
  return data;
}

export async function getOpenTickets(guildId) {
  const { data, error } = await db
    .from('tickets')
    .select('*')
    .eq('guild_id', guildId)
    .in('status', ['open', 'claimed', 'locked'])
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      const all = Array.from(memoryDb.from('tickets').tables?.tickets?.values() || []);
      return all.filter(t => t.guild_id === guildId && ['open', 'claimed', 'locked'].includes(t.status));
    }
    return [];
  }
  return data || [];
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
    if (isMissingTableError(error)) {
      let all = Array.from(memoryDb.from('tickets').tables?.tickets?.values() || [])
        .filter(t => t.guild_id === guildId);
      if (status) all = all.filter(t => t.status === status);
      if (categoryId) all = all.filter(t => t.category_id === categoryId);
      if (ownerId) all = all.filter(t => t.owner_id === ownerId);
      if (claimerId) all = all.filter(t => t.claimed_by === claimerId);
      return all.slice(0, limit);
    }
    return [];
  }
  return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. INTERNAL STAFF NOTES
// ─────────────────────────────────────────────────────────────────────────────
export async function addTicketNote(ticketId, guildId, authorId, authorUsername, content) {
  const record = {
    ticket_id: ticketId,
    guild_id: guildId,
    author_id: authorId,
    author_username: authorUsername,
    content,
    created_at: new Date().toISOString()
  };

  const { data, error } = await db.from('ticket_notes').insert(record).select().single();
  if (error && isMissingTableError(error)) {
    memoryDb.from('ticket_notes').insert(record);
    return record;
  }
  return data || record;
}

export async function getTicketNotes(ticketId) {
  const { data, error } = await db
    .from('ticket_notes')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error && isMissingTableError(error)) {
    return Array.from(memoryDb.from('ticket_notes').tables?.ticket_notes?.values() || [])
      .filter(n => n.ticket_id === ticketId);
  }
  return data || [];
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
    ticket_id: ticketId,
    guild_id: guildId,
    user_id: userId,
    staff_id: staffId,
    rating: Math.min(Math.max(rating, 1), 5),
    feedback: feedback ? feedback.slice(0, 1000) : null,
    created_at: new Date().toISOString()
  };

  const { data, error } = await db.from('ticket_ratings').insert(record).select().single();
  if (error && isMissingTableError(error)) {
    memoryDb.from('ticket_ratings').insert(record);
    return record;
  }
  return data || record;
}

export async function getTicketRatings(guildId, staffId = null) {
  let query = db.from('ticket_ratings').select('*').eq('guild_id', guildId);
  if (staffId) query = query.eq('staff_id', staffId);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error && isMissingTableError(error)) {
    return Array.from(memoryDb.from('ticket_ratings').tables?.ticket_ratings?.values() || [])
      .filter(r => r.guild_id === guildId && (!staffId || r.staff_id === staffId));
  }
  return data || [];
}

export async function getStaffLeaderboard(guildId) {
  // Aggregate claimed tickets, closed tickets, and ratings per staff member
  const allTickets = await db.from('tickets').select('claimed_by, closed_by, status').eq('guild_id', guildId);
  const allRatings = await getTicketRatings(guildId);

  const staffMap = new Map();

  const ensureStaff = (id) => {
    if (!id) return null;
    if (!staffMap.has(id)) {
      staffMap.set(id, { staffId: id, claimedCount: 0, closedCount: 0, totalRatings: 0, ratingSum: 0 });
    }
    return staffMap.get(id);
  };

  const ticketRows = allTickets.data || [];
  for (const t of ticketRows) {
    if (t.claimed_by) {
      const s = ensureStaff(t.claimed_by);
      if (s) s.claimedCount++;
    }
    if (t.closed_by) {
      const s = ensureStaff(t.closed_by);
      if (s) s.closedCount++;
    }
  }

  for (const r of allRatings) {
    if (r.staff_id) {
      const s = ensureStaff(r.staff_id);
      if (s) {
        s.totalRatings++;
        s.ratingSum += r.rating;
      }
    }
  }

  const result = Array.from(staffMap.values()).map(s => ({
    staffId: s.staffId,
    claimed: s.claimedCount,
    closed: s.closedCount,
    reviews: s.totalRatings,
    avgRating: s.totalRatings > 0 ? (s.ratingSum / s.totalRatings).toFixed(1) : 'N/A'
  }));

  // Sort by closed + claimed descending
  return result.sort((a, b) => (b.closed + b.claimed) - (a.closed + a.claimed));
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. TICKET BLACKLIST
// ─────────────────────────────────────────────────────────────────────────────
export async function isBlacklisted(guildId, userId, memberRoleIds = []) {
  const { data, error } = await db
    .from('ticket_blacklist')
    .select('*')
    .eq('guild_id', guildId);

  const list = (error && isMissingTableError(error))
    ? Array.from(memoryDb.from('ticket_blacklist').tables?.ticket_blacklist?.values() || []).filter(b => b.guild_id === guildId)
    : (data || []);

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

  if (error && isMissingTableError(error)) {
    return Array.from(memoryDb.from('ticket_blacklist').tables?.ticket_blacklist?.values() || [])
      .filter(b => b.guild_id === guildId);
  }
  return data || [];
}

export async function addTicketBlacklist(guildId, targetId, targetType, reason, moderatorId) {
  const record = {
    guild_id: guildId,
    target_id: targetId,
    target_type: targetType,
    reason: reason || 'No reason provided',
    moderator_id: moderatorId,
    created_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('ticket_blacklist')
    .upsert(record, { onConflict: 'guild_id, target_id' })
    .select()
    .single();

  if (error && isMissingTableError(error)) {
    const key = `${guildId}:${targetId}`;
    memoryDb.from('ticket_blacklist').tables?.ticket_blacklist?.set(key, record);
    return record;
  }
  return data || record;
}

export async function removeTicketBlacklist(guildId, targetId) {
  const { error } = await db
    .from('ticket_blacklist')
    .delete()
    .eq('guild_id', guildId)
    .eq('target_id', targetId);

  if (error && isMissingTableError(error)) {
    const key = `${guildId}:${targetId}`;
    memoryDb.from('ticket_blacklist').tables?.ticket_blacklist?.delete(key);
    return true;
  }
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

  if (error && isMissingTableError(error)) {
    return Array.from(memoryDb.from('ticket_macros').tables?.ticket_macros?.values() || [])
      .filter(m => m.guild_id === guildId);
  }
  return data || [];
}

export async function getTicketMacro(guildId, name) {
  const { data, error } = await db
    .from('ticket_macros')
    .select('*')
    .eq('guild_id', guildId)
    .ilike('name', name)
    .maybeSingle();

  if (error && isMissingTableError(error)) {
    const all = Array.from(memoryDb.from('ticket_macros').tables?.ticket_macros?.values() || []);
    return all.find(m => m.guild_id === guildId && m.name.toLowerCase() === name.toLowerCase()) || null;
  }
  return data || null;
}

export async function saveTicketMacro(guildId, name, content, createdBy) {
  const id = `mcr_${guildId}_${name.toLowerCase()}`;
  const record = {
    id,
    guild_id: guildId,
    name: name.toLowerCase(),
    content,
    created_by: createdBy,
    created_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('ticket_macros')
    .upsert(record, { onConflict: 'guild_id, name' })
    .select()
    .single();

  if (error && isMissingTableError(error)) {
    memoryDb.from('ticket_macros').tables?.ticket_macros?.set(id, record);
    return record;
  }
  return data || record;
}

export async function deleteTicketMacro(guildId, name) {
  const { error } = await db
    .from('ticket_macros')
    .delete()
    .eq('guild_id', guildId)
    .ilike('name', name);

  if (error && isMissingTableError(error)) {
    const id = `mcr_${guildId}_${name.toLowerCase()}`;
    memoryDb.from('ticket_macros').tables?.ticket_macros?.delete(id);
    return true;
  }
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

  const { data, error } = await db
    .from('ticket_transcripts')
    .upsert(record)
    .select()
    .single();

  if (error && isMissingTableError(error)) {
    memoryDb.from('ticket_transcripts').tables?.ticket_transcripts?.set(id, record);
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

  if (error && isMissingTableError(error)) {
    return memoryDb.from('ticket_transcripts').tables?.ticket_transcripts?.get(`trn_${ticketId}`) || null;
  }
  return data || null;
}
