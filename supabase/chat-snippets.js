/* CHAT snippets — paste after frontend-snippets.js logic */

async function sbRequireEmail() {
  const { data } = await sb.auth.getSession();
  if (data.session && data.session.user.email) return data.session.user;
  const email = prompt('Enter email for chat login (magic link):');
  if (!email) throw new Error('email required for chat');
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
  if (error) throw error;
  alert('Check your email for login link, then click Message again.');
  throw new Error('magic link sent');
}

async function sbOpenDm(otherUserId, animalId, reportId) {
  await sbRequireEmail();
  const { data: cid, error } = await sb.rpc('get_or_create_dm', {
    other_user: otherUserId, p_animal_id: animalId || null, p_report_id: reportId || null
  });
  if (error) throw error;
  return cid;
}

async function sbListMessages(conversationId, limit = 50) {
  const { data, error } = await sb.from('messages').select('*')
    .eq('conversation_id', conversationId).eq('is_deleted', false)
    .order('created_at', { ascending: true }).limit(limit);
  if (error) throw error;
  return data;
}

async function sbSendMessage(conversationId, body) {
  const clean = String(body || '').trim().slice(0, 2000);
  if (!clean) return;
  const { error } = await sb.from('messages').insert([{ conversation_id: conversationId, body: clean }]);
  if (error) throw error;
}

function sbSubscribeDm(conversationId, onMsg) {
  return sb.channel('dm:' + conversationId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + conversationId }, (p) => onMsg(p.new))
    .subscribe();
}
