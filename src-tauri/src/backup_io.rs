use crate::db::{self, Backup, MAX_BACKUP_BYTES};
use std::io::{Read, Write};
use std::path::Path;
type Result<T> = std::result::Result<T, String>;
struct Bounded(Vec<u8>);
impl Write for Bounded {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_BACKUP_BYTES {
            return Err(std::io::Error::other("完整备份超过32 MB，未导出"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub fn read(path: &Path) -> Result<Backup> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take((MAX_BACKUP_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err("备份文件不能超过32 MB".into());
    }
    let backup: Backup =
        serde_json::from_slice(&bytes).map_err(|e| format!("备份格式错误：{e}"))?;
    db::validate_backup(&backup)?;
    Ok(backup)
}
fn atomic_write(
    path: &Path,
    bytes: &[u8],
    write: impl FnOnce(&mut std::fs::File, &[u8]) -> std::io::Result<()>,
) -> Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    write(temp.as_file_mut(), bytes).map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn write(path: &Path, backup: &Backup) -> Result<()> {
    db::validate_backup(backup)?;
    let mut bytes = Bounded(Vec::new());
    serde_json::to_writer_pretty(&mut bytes, backup).map_err(|e| e.to_string())?;
    atomic_write(path, &bytes.0, |file, bytes| {
        file.write_all(bytes)?;
        file.sync_all()
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_write_disk_full_preserves_existing_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.json");
        std::fs::write(&path, b"original backup").unwrap();
        assert!(atomic_write(&path, b"replacement", |file, _| {
            file.write_all(b"partial")?;
            Err(std::io::Error::from_raw_os_error(112))
        })
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original backup");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn real_file_roundtrip_limits_and_invalid_destinations() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.json");
        let mut c = rusqlite::Connection::open_in_memory().unwrap();
        db::migrate(&mut c).unwrap();
        let backup = db::export(&c).unwrap();
        write(&path, &backup).unwrap();
        assert_eq!(read(&path).unwrap().version, 2);
        // Replacing an existing complete file must also succeed on Windows.
        write(&path, &backup).unwrap();
        assert_eq!(read(&path).unwrap().water_entries.unwrap().len(), 0);
        assert!(write(&dir.path().join("missing").join("out.json"), &backup).is_err());
        assert!(write(dir.path(), &backup).is_err());
        assert_eq!(read(&path).unwrap().version, 2);
        let file = std::fs::File::create(&path).unwrap();
        file.set_len((MAX_BACKUP_BYTES + 1) as u64).unwrap();
        assert!(read(&path).unwrap_err().contains("32 MB"));
        std::fs::write(&path, b"{broken").unwrap();
        assert!(read(&path).is_err());
    }
    #[test]
    fn serialization_bound_refuses_overflow_without_truncating() {
        let mut b = Bounded(vec![0; MAX_BACKUP_BYTES - 1]);
        assert_eq!(b.write(b"a").unwrap(), 1);
        assert!(b.write(b"b").is_err());
        assert_eq!(b.0.len(), MAX_BACKUP_BYTES);
    }
}
