CREATE TABLE categories (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
 is_builtin INTEGER NOT NULL CHECK(is_builtin IN (0,1)), sort_order INTEGER NOT NULL
);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL CHECK(length(trim(title))>0),
 short_label TEXT, description TEXT, completed INTEGER NOT NULL CHECK(completed IN (0,1)),
 priority INTEGER NOT NULL CHECK(priority IN (0,1,2)), category_id TEXT REFERENCES categories(id),
 sort_order INTEGER NOT NULL CHECK(sort_order>=0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX tasks_date_order ON tasks(date,completed,sort_order);
CREATE TABLE day_marks (date TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('rest','overtime')), note TEXT);
CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
INSERT INTO categories VALUES
 ('work','工作','#8565B8',1,0),('life','生活','#6B9379',1,1),('research','调研','#AB8050',1,2),
 ('development','开发','#6288AD',1,3),('meeting','会议','#AD7191',1,4),('study','学习','#8D83B1',1,5);
