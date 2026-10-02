import mysql from 'mysql2/promise';

function normalizeError(error) {
  if(error?.code==='ER_DUP_ENTRY')throw new Error('UNIQUE constraint failed');
  throw error;
}

function transform(sql) {
  return sql
    .replace(/MAX\(counter\s*,\s*\?\)/gi,'GREATEST(counter,?)')
    .replace(/INSERT INTO collections\(user_id,updated_at\) VALUES\(\?,\?\)/gi,"INSERT INTO collections(user_id,data,updated_at) VALUES(?,'{\\\"words\\\":[],\\\"history\\\":[]}',?)")
    .replace(/DELETE FROM (challenges|sessions|rate_limits) WHERE (?:token_hash|bucket) IN \(SELECT (?:token_hash|bucket) FROM \1 WHERE (expires_at|reset_at)<=\? LIMIT 100\)/gi,(_m,table,_column,expiry)=>`DELETE FROM ${table} WHERE ${expiry}<=? ORDER BY ${expiry} LIMIT 100`);
}

class Statement {
  constructor(db,sql,values=[]) {this.db=db;this.sql=transform(sql);this.values=values;}
  bind(...values) {return new Statement(this.db,this.sql,values);}
  async first() {return this.db.first(this.sql,this.values);}
  async all() {return this.db.all(this.sql,this.values);}
  async run() {return this.db.run(this.sql,this.values);}
}

export class MySQLD1 {
  constructor(connectionString,caCertificate) {
    const url=new URL(connectionString);
    if(url.protocol!=='mysql:'&&url.protocol!=='mysql2:')throw new Error('DATABASE_URL must use the mysql:// scheme.');
    this.pool=mysql.createPool({host:url.hostname,port:Number(url.port)||3306,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:decodeURIComponent(url.pathname.slice(1)),waitForConnections:true,connectionLimit:5,queueLimit:0,enableKeepAlive:true,ssl:{rejectUnauthorized:true,...(caCertificate?{ca:caCertificate}:{})}});
    this.ready=this.initialize();
  }
  prepare(sql) {return new Statement(this,sql);}
  async query(sql,values) {return this.pool.execute(sql,values);}
  async first(sql,values) {
    if(/^DELETE FROM challenges WHERE token_hash=\? RETURNING \*/i.test(sql)) {
      return this.transaction(async conn=>{const [rows]=await conn.execute('SELECT * FROM challenges WHERE token_hash=? FOR UPDATE',values);if(!rows[0])return null;await conn.execute('DELETE FROM challenges WHERE token_hash=?',values);return rows[0];});
    }
    if(/^UPDATE collections SET data=\?,revision=revision\+1,updated_at=\? WHERE user_id=\? AND revision=\? RETURNING revision/i.test(sql)) {
      return this.transaction(async conn=>{const [result]=await conn.execute('UPDATE collections SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?',values);if(!result.affectedRows)return null;const [rows]=await conn.execute('SELECT revision FROM collections WHERE user_id=?',[values[2]]);return rows[0]||null;});
    }
    if(/^UPDATE users SET recovery_hash=\? WHERE id=\? AND recovery_hash=\? RETURNING id/i.test(sql)) {
      return this.transaction(async conn=>{const [rows]=await conn.execute('SELECT id FROM users WHERE id=? AND recovery_hash=? FOR UPDATE',[values[1],values[2]]);if(!rows[0])return null;await conn.execute('UPDATE users SET recovery_hash=? WHERE id=? AND recovery_hash=?',values);return rows[0];});
    }
    const upsert=/^INSERT INTO rate_limits\(bucket,attempts,reset_at\) VALUES\(\?,1,\?\) ON CONFLICT\(bucket\) DO UPDATE SET attempts=CASE WHEN reset_at<=\? THEN 1 ELSE attempts\+1 END, reset_at=CASE WHEN reset_at<=\? THEN excluded\.reset_at ELSE reset_at END RETURNING attempts,reset_at/i.test(sql);
    if(upsert) {
      try {await this.query('INSERT INTO rate_limits(bucket,attempts,reset_at) VALUES(?,1,?) ON DUPLICATE KEY UPDATE attempts=IF(reset_at<=?,1,attempts+1),reset_at=IF(reset_at<=?,VALUES(reset_at),reset_at)',values);const [rows]=await this.query('SELECT attempts,reset_at FROM rate_limits WHERE bucket=?',[values[0]]);return rows[0]||null;}catch(error){normalizeError(error);}
    }
    try {const [rows]=await this.query(sql,values);return rows[0]||null;}catch(error){normalizeError(error);}
  }
  async all(sql,values) {try {const [results]=await this.query(sql,values);return {results,success:true};}catch(error){normalizeError(error);}}
  async run(sql,values) {try {const [result]=await this.query(sql,values);return {success:true,meta:{changes:result.affectedRows}};}catch(error){normalizeError(error);}}
  async transaction(action) {
    const conn=await this.pool.getConnection();
    try {await conn.beginTransaction();const value=await action(conn);await conn.commit();return value;}
    catch(error){await conn.rollback();normalizeError(error);}
    finally{conn.release();}
  }
  async batch(statements) {
    return this.transaction(async conn=>{
      const results=[];
      for(const statement of statements) {const [result]=await conn.execute(statement.sql,statement.values);results.push({success:true,meta:{changes:result.affectedRows||0},results:result});}
      return results;
    });
  }
  async initialize() {
    const schema=[
      `CREATE TABLE IF NOT EXISTS users (id CHAR(36) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, display_name VARCHAR(100) NOT NULL, recovery_hash CHAR(43) NOT NULL, created_at BIGINT NOT NULL, email VARCHAR(254) NULL UNIQUE, password_salt VARCHAR(32), password_hash VARCHAR(43)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS credentials (id VARCHAR(512) PRIMARY KEY, user_id CHAR(36) NOT NULL, public_key TEXT NOT NULL, counter BIGINT NOT NULL DEFAULT 0, transports TEXT NOT NULL, INDEX credentials_user(user_id), CONSTRAINT credentials_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(43) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at BIGINT NOT NULL, INDEX sessions_expiry(expires_at), CONSTRAINT sessions_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS challenges (token_hash CHAR(43) PRIMARY KEY, challenge VARCHAR(512) NOT NULL, ceremony VARCHAR(32) NOT NULL, user_id CHAR(36), username VARCHAR(64), display_name VARCHAR(100), expires_at BIGINT NOT NULL, email VARCHAR(254), INDEX challenges_expiry(expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS collections (user_id CHAR(36) PRIMARY KEY, data LONGTEXT NOT NULL, revision INT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL, CONSTRAINT collections_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      `CREATE TABLE IF NOT EXISTS rate_limits (bucket VARCHAR(255) PRIMARY KEY, attempts INT NOT NULL, reset_at BIGINT NOT NULL, INDEX rate_limits_expiry(reset_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    ];
    const conn=await this.pool.getConnection();
    try {for(const sql of schema)await conn.query(sql);}finally{conn.release();}
  }
  async close() {await this.pool.end();}
}
