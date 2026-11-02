CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  password_hash TEXT NOT NULL,
  notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_lowercase CHECK (email = LOWER(email))
);

CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE favorites (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport VARCHAR(20) NOT NULL CHECK (sport IN ('football', 'basketball', 'baseball')),
  team_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, sport, team_id)
);
