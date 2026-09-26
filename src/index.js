// SQLPub API 配置
const SQLPUB_API_URL = 'https://client.sqlpub.com/api/database/execute';
const SQLPUB_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Ind4d2xfdXNlciIsImV4cCI6MTc5MDQ5MTY1NX0.4EWFhSRedSqnFQtbJIpGl3TwMMadXww6iJ40N1ww2RY';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (path.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function executeSQL(sql) {
  const res = await fetch(SQLPUB_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + SQLPUB_TOKEN,
    },
    body: JSON.stringify({ sql: sql }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errorMessage || 'SQL 执行失败');
  }
  return data.data || [];
}

// 生成7位16进制ID：前缀 + 6位随机16进制
function generateId(prefix) {
  const hex = Math.random().toString(16).substring(2, 8).toUpperCase();
  return prefix + hex;
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  try {
    // 短剧 CRUD
    if (path === '/api/dramas' && method === 'GET') return await getDramas();
    if (path === '/api/dramas' && method === 'POST') {
      const body = await request.json();
      return await createDrama(body);
    }
    if (path.match(/^\/api\/dramas\/[^/]+$/) && method === 'DELETE') {
      const dramaId = path.split('/').pop();
      return await deleteDrama(dramaId);
    }

    // 演员 CRUD
    if (path === '/api/actors' && method === 'GET') {
      const gender = url.searchParams.get('gender');
      return await getActors(gender);
    }
    if (path === '/api/actors' && method === 'POST') {
      const body = await request.json();
      return await createActor(body);
    }
    if (path.match(/^\/api\/actors\/[^/]+$/) && method === 'PUT') {
      const actorId = path.split('/').pop();
      const body = await request.json();
      return await updateActor(actorId, body);
    }
    if (path.match(/^\/api\/actors\/[^/]+$/) && method === 'DELETE') {
      const actorId = path.split('/').pop();
      return await deleteActor(actorId);
    }

    // 标签
    if (path === '/api/tags' && method === 'GET') return await getTags();

    // 统计
    if (path === '/api/overview' && method === 'GET') return await getOverview();

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ========== 短剧 CRUD ==========
async function createDrama(data) {
  // 1. 生成短剧ID
  const maxIdResult = await executeSQL('SELECT MAX(CAST(drama_id AS UNSIGNED)) as max_id FROM drama');
  const nextId = (maxIdResult[0].max_id || 0) + 1;
  const dramaId = String(nextId).padStart(5, '0');
  const dramaName = data.dramaName;
  const watchTime = data.watchTime || new Date().toISOString().slice(0, 19).replace('T', ' ');

  // 2. 处理所有演员，收集ID
  const allActorIds = [];
  // 女演员
  for (const f of (data.females || [])) {
    let actorId = f.aId;
    if (!actorId) {
      const existing = await executeSQL("SELECT actor_id FROM actor WHERE actor_name = '" + f.actor.replace(/'/g, "''") + "'");
      if (existing.length > 0) {
        actorId = existing[0].actor_id;
      } else {
        actorId = generateId('A'); // 女演员A开头
        await executeSQL("INSERT INTO actor (actor_id, actor_name, gender) VALUES ('" + actorId + "', '" + f.actor.replace(/'/g, "''") + "', 'f')");
      }
    }
    allActorIds.push(actorId);
  }
  // 男演员
  for (const m of (data.males || [])) {
    let actorId = m.aId;
    if (!actorId) {
      const existing = await executeSQL("SELECT actor_id FROM actor WHERE actor_name = '" + m.actor.replace(/'/g, "''") + "'");
      if (existing.length > 0) {
        actorId = existing[0].actor_id;
      } else {
        actorId = generateId('B'); // 男演员B开头
        await executeSQL("INSERT INTO actor (actor_id, actor_name, gender) VALUES ('" + actorId + "', '" + m.actor.replace(/'/g, "''") + "', 'm')");
      }
    }
    allActorIds.push(actorId);
  }

  // 3. 处理所有标签，收集ID
  const allTagIds = [];
  for (const tagName of (data.tags || [])) {
    let tagId;
    const existing = await executeSQL("SELECT tag_id FROM tag WHERE tag_name = '" + tagName.replace(/'/g, "''") + "'");
    if (existing.length > 0) {
      tagId = existing[0].tag_id;
    } else {
      tagId = generateId('T'); // 标签T开头
      await executeSQL("INSERT INTO tag (tag_id, tag_name) VALUES ('" + tagId + "', '" + tagName.replace(/'/g, "''") + "')");
    }
    allTagIds.push(tagId);
  }

  // 4. 插入drama总表，演员ID和标签ID用逗号分隔存进去
  await executeSQL(
    "INSERT INTO drama (drama_id, drama_name, watch_time, actor_ids, tag_ids) VALUES ('" +
    dramaId + "', '" + dramaName.replace(/'/g, "''") + "', '" + watchTime + "', '" +
    allActorIds.join(',') + "', '" + allTagIds.join(',') + "')"
  );

  return jsonResponse({ success: true, dramaId });
}

async function deleteDrama(dramaId) {
  await executeSQL("DELETE FROM drama WHERE drama_id = '" + dramaId + "'");
  return jsonResponse({ success: true });
}

// ========== 演员 CRUD ==========
async function createActor(data) {
  // 根据性别生成ID：女A开头，男B开头
  const prefix = data.gender === 'f' ? 'A' : 'B';
  const actorId = generateId(prefix);
  await executeSQL("INSERT INTO actor (actor_id, actor_name, gender, birthday, debut_work) VALUES ('" +
    actorId + "', '" + data.actorName.replace(/'/g, "''") + "', '" + data.gender + "', '" +
    (data.birthday || '') + "', '" + (data.debutWork || '') + "')");
  return jsonResponse({ success: true, actorId });
}

async function updateActor(actorId, data) {
  const updates = [];
  if (data.birthday !== undefined) updates.push("birthday = '" + data.birthday.replace(/'/g, "''") + "'");
  if (data.debutWork !== undefined) updates.push("debut_work = '" + data.debutWork.replace(/'/g, "''") + "'");
  if (data.actorName !== undefined) updates.push("actor_name = '" + data.actorName.replace(/'/g, "''") + "'");
  
  if (updates.length === 0) return jsonResponse({ error: '没有要更新的字段' }, 400);
  await executeSQL("UPDATE actor SET " + updates.join(', ') + " WHERE actor_id = '" + actorId + "'");
  return jsonResponse({ success: true });
}

async function deleteActor(actorId) {
  await executeSQL("DELETE FROM actor WHERE actor_id = '" + actorId + "'");
  return jsonResponse({ success: true });
}

// ========== 查询接口 ==========
async function getOverview() {
  const actorCount = await executeSQL('SELECT COUNT(*) as total FROM actor');
  const femaleCount = await executeSQL("SELECT COUNT(*) as total FROM actor WHERE gender = 'f'");
  const maleCount = await executeSQL("SELECT COUNT(*) as total FROM actor WHERE gender = 'm'");
  const dramaCount = await executeSQL('SELECT COUNT(*) as total FROM drama');
  
  return jsonResponse({
    actorCount: actorCount[0].total,
    femaleCount: femaleCount[0].total,
    maleCount: maleCount[0].total,
    dramaCount: dramaCount[0].total,
  });
}

async function getActors(gender) {
  // 查所有演员，统计每个演员在多少部剧里出现过
  const dramas = await executeSQL('SELECT actor_ids FROM drama');
  const dramaCountMap = {};
  dramas.forEach(d => {
    if (!d.actor_ids) return;
    d.actor_ids.split(',').forEach(actorId => {
      dramaCountMap[actorId] = (dramaCountMap[actorId] || 0) + 1;
    });
  });

  let query = "SELECT * FROM actor WHERE 1=1";
  if (gender) query += " AND gender = '" + gender + "'";
  query += " ORDER BY actor_name ASC";
  
  const actors = await executeSQL(query);
  return jsonResponse(actors.map(a => ({
    ...a,
    drama_count: dramaCountMap[a.actor_id] || 0
  })));
}

async function getDramas() {
  // 1. 查所有剧
  const dramas = await executeSQL('SELECT * FROM drama ORDER BY watch_time DESC, drama_name ASC');
  // 2. 查所有演员和标签，方便拼名字
  const allActors = await executeSQL('SELECT actor_id, actor_name, gender FROM actor');
  const allTags = await executeSQL('SELECT tag_id, tag_name FROM tag');
  const actorMap = {};
  allActors.forEach(a => actorMap[a.actor_id] = a);
  const tagMap = {};
  allTags.forEach(t => tagMap[t.tag_id] = t);

  // 3. 把剧里的actor_ids和tag_ids转成名字
  return jsonResponse(dramas.map(d => {
    const females = [];
    const males = [];
    if (d.actor_ids) {
      d.actor_ids.split(',').forEach(actorId => {
        const actor = actorMap[actorId];
        if (actor) {
          if (actor.gender === 'f') females.push({ aId: actor.actor_id, actor: actor.actor_name, role: '' });
          else males.push({ aId: actor.actor_id, actor: actor.actor_name, role: '' });
        }
      });
    }
    const tags = [];
    if (d.tag_ids) {
      d.tag_ids.split(',').forEach(tagId => {
        const tag = tagMap[tagId];
        if (tag) tags.push(tag.tag_name);
      });
    }
    return {
      drama_id: d.drama_id,
      drama_name: d.drama_name,
      watch_time: d.watch_time,
      females,
      males,
      tags
    };
  }));
}

async function getTags() {
  const dramas = await executeSQL('SELECT tag_ids FROM drama');
  const tagCountMap = {};
  dramas.forEach(d => {
    if (!d.tag_ids) return;
    d.tag_ids.split(',').forEach(tagId => {
      tagCountMap[tagId] = (tagCountMap[tagId] || 0) + 1;
    });
  });

  const tags = await executeSQL('SELECT * FROM tag ORDER BY tag_name ASC');
  return jsonResponse(tags.map(t => ({
    ...t,
    drama_count: tagCountMap[t.tag_id] || 0
  })));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
