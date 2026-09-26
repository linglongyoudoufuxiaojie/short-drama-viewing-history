// SQLPub API 配置
const SQLPUB_API_URL = 'https://client.sqlpub.com/api/database/execute';
const SQLPUB_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Ind4d2xfdXNlciIsImV4cCI6MTc5MDQ5MTY1NX0.4EWFhSRedSqnFQtbJIpGl3TwMMadXww6iJ40N1ww2RY';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 处理
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // API 路由
    if (path.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // 其他请求交给静态资源处理
    return env.ASSETS.fetch(request);
  },
};

// 执行 SQL 的 helper 函数
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

// 生成唯一 ID
function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  try {
    // 短剧相关
    if (path === '/api/dramas' && method === 'GET') {
      return await getDramas();
    }
    if (path === '/api/dramas' && method === 'POST') {
      const body = await request.json();
      return await createDrama(body);
    }
    if (path.match(/^\/api\/dramas\/[^/]+$/) && method === 'DELETE') {
      const dramaId = path.split('/').pop();
      return await deleteDrama(dramaId);
    }

    // 演员相关
    if (path === '/api/actors' && method === 'GET') {
      const gender = url.searchParams.get('gender');
      return await getActors(gender);
    }
    if (path.match(/^\/api\/actors\/[^/]+$/) && method === 'DELETE') {
      const actorId = path.split('/').pop();
      return await deleteActor(actorId);
    }

    // 统计相关
    if (path === '/api/overview' && method === 'GET') {
      return await getOverview();
    }
    if (path === '/api/recent' && method === 'GET') {
      return await getRecent();
    }
    if (path === '/api/stats' && method === 'GET') {
      return await getStats();
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

// ========== 短剧 CRUD ==========

async function createDrama(data) {
  // drama_id 是 varchar(5)，用短数字 ID
  const maxIdResult = await executeSQL('SELECT MAX(CAST(drama_id AS UNSIGNED)) as max_id FROM drama');
  const nextId = (maxIdResult[0].max_id || 0) + 1;
  const dramaId = String(nextId).padStart(5, '0');
  const dramaName = data.dramaName;
  const watchTime = data.watchTime || new Date().toISOString().slice(0, 19).replace('T', ' ');

  // 1. 插入短剧
  await executeSQL("INSERT INTO drama (drama_id, drama_name, watch_time) VALUES ('" + dramaId + "', '" + dramaName.replace(/'/g, "''") + "', '" + watchTime + "')");

  // 2. 处理女演员
  if (data.females && data.females.length > 0) {
    for (const f of data.females) {
      let actorId = f.aId;
      if (!actorId) {
        const existing = await executeSQL("SELECT actor_id FROM actor WHERE actor_name = '" + f.actor.replace(/'/g, "''") + "' AND gender = 'f'");
        if (existing.length > 0) {
          actorId = existing[0].actor_id;
        } else {
          actorId = generateId('a');
          await executeSQL("INSERT INTO actor (actor_id, actor_name, gender) VALUES ('" + actorId + "', '" + f.actor.replace(/'/g, "''") + "', 'f')");
        }
      }
      await executeSQL("INSERT INTO drama_cast (cast_id, drama_id, actor_id, role_name) VALUES ('" + generateId('c') + "', '" + dramaId + "', '" + actorId + "', '" + (f.role || '未标注').replace(/'/g, "''") + "')");
    }
  }

  // 3. 处理男演员
  if (data.males && data.males.length > 0) {
    for (const m of data.males) {
      let actorId = m.aId;
      if (!actorId) {
        const existing = await executeSQL("SELECT actor_id FROM actor WHERE actor_name = '" + m.actor.replace(/'/g, "''") + "' AND gender = 'm'");
        if (existing.length > 0) {
          actorId = existing[0].actor_id;
        } else {
          actorId = generateId('a');
          await executeSQL("INSERT INTO actor (actor_id, actor_name, gender) VALUES ('" + actorId + "', '" + m.actor.replace(/'/g, "''") + "', 'm')");
        }
      }
      await executeSQL("INSERT INTO drama_cast (cast_id, drama_id, actor_id, role_name) VALUES ('" + generateId('c') + "', '" + dramaId + "', '" + actorId + "', '" + (m.role || '未标注').replace(/'/g, "''") + "')");
    }
  }

  // 4. 处理标签
  if (data.tags && data.tags.length > 0) {
    for (const tagName of data.tags) {
      let tagId;
      const existing = await executeSQL("SELECT tag_id FROM tag WHERE tag_name = '" + tagName.replace(/'/g, "''") + "'");
      if (existing.length > 0) {
        tagId = existing[0].tag_id;
      } else {
        tagId = generateId('t');
        await executeSQL("INSERT INTO tag (tag_id, tag_name) VALUES ('" + tagId + "', '" + tagName.replace(/'/g, "''") + "')");
      }
      await executeSQL("INSERT INTO drama_tag (dt_id, drama_id, tag_id) VALUES ('" + generateId('dt') + "', '" + dramaId + "', '" + tagId + "')");
    }
  }

  return jsonResponse({ success: true, dramaId });
}

async function deleteDrama(dramaId) {
  await executeSQL("DELETE FROM drama_cast WHERE drama_id = '" + dramaId + "'");
  await executeSQL("DELETE FROM drama_tag WHERE drama_id = '" + dramaId + "'");
  await executeSQL("DELETE FROM drama WHERE drama_id = '" + dramaId + "'");
  return jsonResponse({ success: true });
}

// ========== 演员 CRUD ==========

async function deleteActor(actorId) {
  await executeSQL("DELETE FROM drama_cast WHERE actor_id = '" + actorId + "'");
  await executeSQL("DELETE FROM actor WHERE actor_id = '" + actorId + "'");
  return jsonResponse({ success: true });
}

// ========== 查询接口 ==========

async function getOverview() {
  const actorCount = await executeSQL('SELECT COUNT(*) as total FROM actor');
  const femaleCount = await executeSQL("SELECT COUNT(*) as total FROM actor WHERE gender = 'f'");
  const maleCount = await executeSQL("SELECT COUNT(*) as total FROM actor WHERE gender = 'm'");
  const dramaCount = await executeSQL('SELECT COUNT(*) as total FROM drama');
  
  const recentDramas = await executeSQL(`
    SELECT d.drama_id, d.drama_name, d.watch_time,
      GROUP_CONCAT(CASE WHEN a.gender = 'f' THEN a.actor_name END) as female_actors,
      GROUP_CONCAT(CASE WHEN a.gender = 'm' THEN a.actor_name END) as male_actors,
      GROUP_CONCAT(CASE WHEN a.gender = 'f' THEN dc.role_name END) as female_roles,
      GROUP_CONCAT(CASE WHEN a.gender = 'm' THEN dc.role_name END) as male_roles
    FROM drama d
    LEFT JOIN drama_cast dc ON d.drama_id = dc.drama_id
    LEFT JOIN actor a ON dc.actor_id = a.actor_id
    WHERE d.watch_time IS NOT NULL
    GROUP BY d.drama_id
    ORDER BY d.watch_time DESC
    LIMIT 10
  `);

  return jsonResponse({
    actorCount: actorCount[0].total,
    femaleCount: femaleCount[0].total,
    maleCount: maleCount[0].total,
    dramaCount: dramaCount[0].total,
    recentDramas: recentDramas,
  });
}

async function getActors(gender) {
  let query = `
    SELECT a.actor_id, a.actor_name, a.gender, a.birthday, a.debut_work,
      COUNT(dc.cast_id) as drama_count
    FROM actor a
    LEFT JOIN drama_cast dc ON a.actor_id = dc.actor_id
  `;
  
  if (gender) {
    query += " WHERE a.gender = '" + gender + "'";
  }
  
  query += ' GROUP BY a.actor_id ORDER BY drama_count DESC, a.actor_name ASC';
  
  const actors = await executeSQL(query);
  return jsonResponse(actors);
}

async function getDramas() {
  const dramas = await executeSQL(`
    SELECT d.drama_id, d.drama_name, d.watch_time, d.remark,
      GROUP_CONCAT(CASE WHEN a.gender = 'f' THEN CONCAT(a.actor_id, ':', a.actor_name, ':', dc.role_name) END) as females,
      GROUP_CONCAT(CASE WHEN a.gender = 'm' THEN CONCAT(a.actor_id, ':', a.actor_name, ':', dc.role_name) END) as males,
      GROUP_CONCAT(t.tag_name) as tags
    FROM drama d
    LEFT JOIN drama_cast dc ON d.drama_id = dc.drama_id
    LEFT JOIN actor a ON dc.actor_id = a.actor_id
    LEFT JOIN drama_tag dt ON d.drama_id = dt.drama_id
    LEFT JOIN tag t ON dt.tag_id = t.tag_id
    GROUP BY d.drama_id
    ORDER BY d.watch_time DESC, d.drama_name ASC
  `);
  
  return jsonResponse(dramas);
}

async function getRecent() {
  const recent = await executeSQL(`
    SELECT d.drama_id, d.drama_name, d.watch_time,
      GROUP_CONCAT(CASE WHEN a.gender = 'f' THEN a.actor_name END) as female_actors,
      GROUP_CONCAT(CASE WHEN a.gender = 'm' THEN a.actor_name END) as male_actors
    FROM drama d
    LEFT JOIN drama_cast dc ON d.drama_id = dc.drama_id
    LEFT JOIN actor a ON dc.actor_id = a.actor_id
    WHERE d.watch_time IS NOT NULL
    GROUP BY d.drama_id
    ORDER BY d.watch_time DESC
    LIMIT 20
  `);
  
  return jsonResponse(recent);
}

async function getStats() {
  const actorDistribution = await executeSQL(`
    SELECT drama_count, COUNT(*) as actor_num
    FROM (
      SELECT a.actor_id, COUNT(dc.cast_id) as drama_count
      FROM actor a
      LEFT JOIN drama_cast dc ON a.actor_id = dc.actor_id
      GROUP BY a.actor_id
    ) as sub
    GROUP BY drama_count
    ORDER BY drama_count
  `);

  return jsonResponse({ actorDistribution });
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
