-- Independent optional widget; task schema and ordering remain unchanged.
CREATE TABLE water_entries (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 10000),
    recorded_at TEXT NOT NULL
);
CREATE INDEX water_entries_date ON water_entries(date);
PRAGMA user_version=2;
