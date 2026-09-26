import { connect } from 'mysql2';

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

  try {
    switch (path) {
      case '/api/overview':
        return await getOverview(env);
      case '/api/actors':
        const gender = url.searchParams.get('gender');
        return await getActors(env, gender);
      case '/api/dramas':
        return await getDramas(env);
      case '/api/recent':
        return await getRecent(env);
      case '/api/stats':
        return await getStats(env);
      default:
        return jsonResponse({ error: 'Not found' }, 404);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function getDbConnection(env) {
  // 使用 Hyperdrive 连接
  const hyperdrive = env.HYPERDRIVE;
  const conn = await connect(hyperdrive.connectionString);
  return conn;
}

async function getOverview(env) {
  const conn = await getDbConnection(env);
  
  // 统计演员数量
  const [actorCount] = await conn.execute('SELECT COUNT(*) as total FROM actor');
  const [femaleCount] = await conn.execute("SELECT COUNT(*) as total FROM actor WHERE gender = 'f'");
  const [maleCount] = await conn.execute("SELECT COUNT(*) as total FROM actor WHERE gender = 'm'");
  
  // 统计剧集数量
  const [dramaCount] = await conn.execute('SELECT COUNT(*) as total FROM drama');
  
  // 最近观看的剧集
  const [recentDramas] = await conn.execute(`
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
  
  const [actors] = await conn.execute(query, params);
  
  // 解析 roles JSON
  const result = actors.map(a => ({
    ...a,
    roles: a.roles ? JSON.parse('[' + a.roles + ']') : [],
  }));

  await conn.end();
  return jsonResponse(result);
}

async function getDramas(env) {
  const conn = await getDbConnection(env);
  
  const [dramas] = await conn.execute(`
    SELECT d.drama_id, d.drama_name, d.watch_time, d.remark,
      GROUP_CONCAT(CASE WHEN a.gender = 'f' THEN JSON_OBJECT('actor', a.actor_name, 'role', dc.role_name) END) as females,
      GROUP_CONCAT(CASE WHEN a.gender = 'm' THEN JSON_OBJECT('actor', a.actor_name, 'role', dc.role_name) END) as males,
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
  
  const [recent] = await conn.execute(`
    SELECT d.drama_id, d.drama_name, d.watch_time,
      GROUP_CONCAT(CASE WHEN a.gender = 'f' THEN JSON_OBJECT('actor', a.actor_name, 'role', dc.role_name) END) as females,
      GROUP_CONCAT(CASE WHEN a.gender = 'm' THEN JSON_OBJECT('actor', a.actor_name, 'role', dc.role_name) END) as males
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
  
  // 演员出演次数分布
  const [actorDistribution] = await conn.execute(`
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
