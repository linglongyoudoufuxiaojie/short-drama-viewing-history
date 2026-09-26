import { createConnection } from 'mysql2/promise';

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

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  try {
    // 短剧相关
    if (path === '/api/dramas' && method === 'GET') {
      return await getDramas(env);
    }
    if (path === '/api/dramas' && method === 'POST') {
      const body = await request.json();
      return await createDrama(env, body);
    }
    if (path.match(/^\/api\/dramas\/[^/]+$/) && method === 'DELETE') {
      const dramaId = path.split('/').pop();
      return await deleteDrama(env, dramaId);
    }

    // 演员相关
    if (path === '/api/actors' && method === 'GET') {
      const gender = url.searchParams.get('gender');
      return await getActors(env, gender);
    }
    if (path.match(/^\/api\/actors\/[^/]+$/) && method === 'PUT') {
      const actorId = path.split('/').pop();
      const body = await request.json();
      return await updateActor(env, actorId, body);
    }
    if (path.match(/^\/api\/actors\/[^/]+$/) && method === 'DELETE') {
      const actorId = path.split('/').pop();
      return await deleteActor(env, actorId);
    }

    // 统计相关
    if (path === '/api/overview' && method === 'GET') {
      return await getOverview(env);
    }
    if (path === '/api/recent' && method === 'GET') {
      return await getRecent(env);
    }
    if (path === '/api/stats' && method === 'GET') {
      return await getStats(env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function getDbConnection(env) {
  const hyperdrive = env.HYPERDRIVE;
  const conn = await createConnection(hyperdrive.connectionString);
  return conn;
}

// 生成唯一 ID
function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

// ========== 短剧 CRUD ==========

async function createDrama(env, data) {
  const conn = await getDbConnection(env);
  
  try {
    await conn.beginTransaction();

    const dramaId = generateId('d');
    const dramaName = data.dramaName;
    const watchTime = data.watchTime || new Date().toISOString().slice(0, 19).replace('T', ' ');

    // 1. 插入短剧
    await conn.query(
      'INSERT INTO drama (drama_id, drama_name, watch_time) VALUES (?, ?, ?)',
      [dramaId, dramaName, watchTime]
    );

    // 2. 处理女演员
    if (data.females && data.females.length > 0) {
      for (const f of data.females) {
        let actorId = f.aId;
        // 如果没有 aId，按名字查找或新建
        if (!actorId) {
          const [existing] = await conn.query(
            "SELECT actor_id FROM actor WHERE actor_name = ? AND gender = 'f'",
            [f.actor]
          );
          if (existing.length > 0) {
            actorId = existing[0].actor_id;
          } else {
            actorId = generateId('a');
            await conn.query(
              "INSERT INTO actor (actor_id, actor_name, gender) VALUES (?, ?, 'f')",
              [actorId, f.actor]
            );
          }
        }
        // 插入演员表
        await conn.query(
          'INSERT INTO drama_cast (cast_id, drama_id, actor_id, role_name) VALUES (?, ?, ?, ?)',
          [generateId('c'), dramaId, actorId, f.role || '未标注']
        );
      }
    }

    // 3. 处理男演员
    if (data.males && data.males.length > 0) {
      for (const m of data.males) {
        let actorId = m.aId;
        if (!actorId) {
          const [existing] = await conn.query(
            "SELECT actor_id FROM actor WHERE actor_name = ? AND gender = 'm'",
            [m.actor]
          );
          if (existing.length > 0) {
            actorId = existing[0].actor_id;
          } else {
            actorId = generateId('a');
            await conn.query(
              "INSERT INTO actor (actor_id, actor_name, gender) VALUES (?, ?, 'm')",
              [actorId, m.actor]
            );
          }
        }
        await conn.query(
          'INSERT INTO drama_cast (cast_id, drama_id, actor_id, role_name) VALUES (?, ?, ?, ?)',
          [generateId('c'), dramaId, actorId, m.role || '未标注']
        );
      }
    }

    // 4. 处理标签
    if (data.tags && data.tags.length > 0) {
      for (const tagName of data.tags) {
        let tagId;
        const [existing] = await conn.query(
          'SELECT tag_id FROM tag WHERE tag_name = ?',
          [tagName]
        );
        if (existing.length > 0) {
          tagId = existing[0].tag_id;
        } else {
          tagId = generateId('t');
          await conn.query(
            'INSERT INTO tag (tag_id, tag_name) VALUES (?, ?)',
            [tagId, tagName]
          );
        }
        await conn.query(
          'INSERT INTO drama_tag (dt_id, drama_id, tag_id) VALUES (?, ?, ?)',
          [generateId('dt'), dramaId, tagId]
        );
      }
    }

    await conn.commit();
    return jsonResponse({ success: true, dramaId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

async function deleteDrama(env, dramaId) {
  const conn = await getDbConnection(env);
  
  try {
    await conn.beginTransaction();
    
    // 删除演员表
    await conn.query('DELETE FROM drama_cast WHERE drama_id = ?', [dramaId]);
    // 删除标签关联
    await conn.query('DELETE FROM drama_tag WHERE drama_id = ?', [dramaId]);
    // 删除短剧
    await conn.query('DELETE FROM drama WHERE drama_id = ?', [dramaId]);
    
    await conn.commit();
    return jsonResponse({ success: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

// ========== 演员 CRUD ==========

async function updateActor(env, actorId, data) {
  const conn = await getDbConnection(env);
  
  const updates = [];
  const params = [];
  
  if (data.birthday !== undefined) {
    updates.push('birthday = ?');
    params.push(data.birthday);
  }
  if (data.debutWork !== undefined) {
    updates.push('debut_work = ?');
    params.push(data.debutWork);
  }
  if (data.actorName !== undefined) {
    updates.push('actor_name = ?');
    params.push(data.actorName);
  }
  
  if (updates.length === 0) {
    await conn.end();
    return jsonResponse({ error: 'No fields to update' }, 400);
  }
  
  params.push(actorId);
  await conn.query(
    `UPDATE actor SET ${updates.join(', ')} WHERE actor_id = ?`,
    params
  );
  
  await conn.end();
  return jsonResponse({ success: true });
}

async function deleteActor(env, actorId) {
  const conn = await getDbConnection(env);
  
  try {
    await conn.beginTransaction();
    
    // 删除演员表关联
    await conn.query('DELETE FROM drama_cast WHERE actor_id = ?', [actorId]);
    // 删除演员
    await conn.query('DELETE FROM actor WHERE actor_id = ?', [actorId]);
    
    await conn.commit();
    return jsonResponse({ success: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

// ========== 查询接口（保持不变） ==========

async function getOverview(env) {
  const conn = await getDbConnection(env);
  
  const [actorCount] = await conn.query('SELECT COUNT(*) as total FROM actor');
  const [femaleCount] = await conn.query("SELECT COUNT(*) as total FROM actor WHERE gender = 'f'");
  const [maleCount] = await conn.query("SELECT COUNT(*) as total FROM actor WHERE gender = 'm'");
  const [dramaCount] = await conn.query('SELECT COUNT(*) as total FROM drama');
  
  const [recentDramas] = await conn.query(`
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

  await conn.end();

  return jsonResponse({
    actorCount: actorCount[0].total,
    femaleCount: femaleCount[0].total,
    maleCount: maleCount[0].total,
    dramaCount: dramaCount[0].total,
    recentDramas: recentDramas,
  });
}

async function getActors(env, gender) {
  const conn = await getDbConnection(env);
  
  let query = `
    SELECT a.actor_id, a.actor_name, a.gender, a.birthday, a.debut_work,
      COUNT(dc.cast_id) as drama_count,
      GROUP_CONCAT(JSON_OBJECT('drama', d.drama_name, 'role', dc.role_name)) as roles
    FROM actor a
    LEFT JOIN drama_cast dc ON a.actor_id = dc.actor_id
    LEFT JOIN drama d ON dc.drama_id = d.drama_id
  `;
  
  const params = [];
  if (gender) {
    query += ' WHERE a.gender = ?';
    params.push(gender);
  }
  
  query += ' GROUP BY a.actor_id ORDER BY drama_count DESC, a.actor_name ASC';
  
  const [actors] = await conn.query(query, params);
  
  const result = actors.map(a => ({
    ...a,
    roles: a.roles ? JSON.parse('[' + a.roles + ']') : [],
  }));

  await conn.end();
  return jsonResponse(result);
}

async function getDramas(env) {
  const conn = await getDbConnection(env);
  
  const [dramas] = await conn.query(`
    SELECT d.drama_id, d.drama_name, d.watch_time, d.remark,
      GROUP_CONCAT(CASE WHEN a.gender = 'f' THEN JSON_OBJECT('actor_id', a.actor_id, 'actor', a.actor_name, 'role', dc.role_name) END) as females,
      GROUP_CONCAT(CASE WHEN a.gender = 'm' THEN JSON_OBJECT('actor_id', a.actor_id, 'actor', a.actor_name, 'role', dc.role_name) END) as males,
      GROUP_CONCAT(t.tag_name) as tags
    FROM drama d
    LEFT JOIN drama_cast dc ON d.drama_id = dc.drama_id
    LEFT JOIN actor a ON dc.actor_id = a.actor_id
    LEFT JOIN drama_tag dt ON d.drama_id = dt.drama_id
    LEFT JOIN tag t ON dt.tag_id = t.tag_id
    GROUP BY d.drama_id
    ORDER BY d.watch_time DESC, d.drama_name ASC
  `);
  
  const result = dramas.map(d => ({
    ...d,
    females: d.females ? JSON.parse('[' + d.females + ']') : [],
    males: d.males ? JSON.parse('[' + d.males + ']') : [],
    tags: d.tags ? d.tags.split(',') : [],
  }));

  await conn.end();
  return jsonResponse(result);
}

async function getRecent(env) {
  const conn = await getDbConnection(env);
  
  const [recent] = await conn.query(`
    SELECT d.drama_id, d.drama_name, d.watch_time,
      GROUP_CONCAT(CASE WHEN a.gender = 'f' THEN JSON_OBJECT('actor_id', a.actor_id, 'actor', a.actor_name, 'role', dc.role_name) END) as females,
      GROUP_CONCAT(CASE WHEN a.gender = 'm' THEN JSON_OBJECT('actor_id', a.actor_id, 'actor', a.actor_name, 'role', dc.role_name) END) as males
    FROM drama d
    LEFT JOIN drama_cast dc ON d.drama_id = dc.drama_id
    LEFT JOIN actor a ON dc.actor_id = a.actor_id
    WHERE d.watch_time IS NOT NULL
    GROUP BY d.drama_id
    ORDER BY d.watch_time DESC
    LIMIT 20
  `);
  
  const result = recent.map(r => ({
    ...r,
    females: r.females ? JSON.parse('[' + r.females + ']') : [],
    males: r.males ? JSON.parse('[' + r.males + ']') : [],
  }));

  await conn.end();
  return jsonResponse(result);
}

async function getStats(env) {
  const conn = await getDbConnection(env);
  
  const [actorDistribution] = await conn.query(`
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

  await conn.end();
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
