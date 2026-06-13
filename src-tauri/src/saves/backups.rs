use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tokio::task;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackupEntry {
    pub timestamp: u64,
    pub created_at: u64,
    pub info_file_size: u64,
    pub main_file_size: u64,
    pub missing_files: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackupCatalog {
    pub save_id: String,
    pub save_folder_path: String,
    pub backups: Vec<SaveBackupEntry>,
}

pub fn current_backup_timestamp() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to get backup timestamp: {}", e))
        .map(|duration| duration.as_secs())
}

pub fn create_backup_with_timestamp(path: &PathBuf, contents: &str, timestamp: u64) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid save file name".to_string())?;
    let backup_name = format!("{}.backup-{}", file_name, timestamp);
    let backup_path = path.with_file_name(backup_name);
    fs::write(&backup_path, contents)
        .map_err(|e| format!("Failed to write backup {}: {}", backup_path.display(), e))
}

pub fn ensure_save_paths(id: &str) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let saves_dir = super::get_saves_dir()
        .ok_or_else(|| "Could not locate APPDATA or HOME directory".to_string())?;
    let save_folder = saves_dir.join(id);
    if !save_folder.exists() {
        return Err(format!("Save folder {} does not exist", id));
    }

    let save_game_info_path = save_folder.join("SaveGameInfo");
    if !save_game_info_path.exists() {
        return Err(format!("SaveGameInfo not found in {}", id));
    }

    let main_save_path = save_folder.join(id);
    if !main_save_path.exists() {
        return Err(format!("Main save file {} not found in {}", id, id));
    }

    Ok((save_folder, save_game_info_path, main_save_path))
}

fn parse_backup_timestamp(file_name: &str, expected_prefix: &str) -> Option<u64> {
    file_name
        .strip_prefix(expected_prefix)
        .and_then(|value| value.parse::<u64>().ok())
}

fn list_save_backups_sync(id: String) -> Result<SaveBackupCatalog, String> {
    let (save_folder, _, _) = ensure_save_paths(&id)?;
    let info_prefix = "SaveGameInfo.backup-";
    let main_prefix = format!("{}.backup-", id);
    let mut backups = std::collections::BTreeMap::<u64, SaveBackupEntry>::new();

    let entries = fs::read_dir(&save_folder)
        .map_err(|e| format!("Failed to read save folder {}: {}", save_folder.display(), e))?;

    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        let backup_match = if let Some(timestamp) = parse_backup_timestamp(&file_name, info_prefix) {
            Some((timestamp, true))
        } else {
            parse_backup_timestamp(&file_name, &main_prefix).map(|timestamp| (timestamp, false))
        };

        let Some((timestamp, is_info_file)) = backup_match else {
            continue;
        };

        let file_size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        let backup = backups.entry(timestamp).or_insert_with(|| SaveBackupEntry {
            timestamp,
            created_at: timestamp,
            info_file_size: 0,
            main_file_size: 0,
            missing_files: Vec::new(),
        });

        if is_info_file {
            backup.info_file_size = file_size;
        } else {
            backup.main_file_size = file_size;
        }
    }

    let mut backup_list = backups.into_values().collect::<Vec<_>>();
    for backup in &mut backup_list {
        if backup.info_file_size == 0 {
            backup.missing_files.push("SaveGameInfo".to_string());
        }
        if backup.main_file_size == 0 {
            backup.missing_files.push(id.clone());
        }
    }
    backup_list.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(SaveBackupCatalog {
        save_id: id,
        save_folder_path: save_folder.to_string_lossy().to_string(),
        backups: backup_list,
    })
}

#[tauri::command]
pub async fn list_save_backups(id: String) -> Result<SaveBackupCatalog, String> {
    task::spawn_blocking(move || list_save_backups_sync(id))
        .await
        .map_err(|e| format!("读取存档备份列表任务失败: {}", e))?
}

#[tauri::command]
pub async fn create_save_backup(id: String) -> Result<SaveBackupCatalog, String> {
    task::spawn_blocking(move || {
        let (_, save_game_info_path, main_save_path) = ensure_save_paths(&id)?;
        let info_xml = fs::read_to_string(&save_game_info_path)
            .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;
        let main_xml = fs::read_to_string(&main_save_path)
            .map_err(|e| format!("Failed to read main save file: {}", e))?;
        let timestamp = current_backup_timestamp()?;
        create_backup_with_timestamp(&save_game_info_path, &info_xml, timestamp)?;
        create_backup_with_timestamp(&main_save_path, &main_xml, timestamp)?;
        list_save_backups_sync(id)
    })
    .await
    .map_err(|e| format!("创建存档备份任务失败: {}", e))?
}

#[tauri::command]
pub async fn restore_save_backup(id: String, timestamp: u64) -> Result<SaveBackupCatalog, String> {
    task::spawn_blocking(move || {
        let (save_folder, save_game_info_path, main_save_path) = ensure_save_paths(&id)?;
        let info_backup_path = save_folder.join(format!("SaveGameInfo.backup-{}", timestamp));
        let main_backup_path = save_folder.join(format!("{}.backup-{}", id, timestamp));
        if !info_backup_path.exists() || !main_backup_path.exists() {
            return Err("选中的备份不完整，无法恢复。".to_string());
        }

        let current_info = fs::read_to_string(&save_game_info_path)
            .map_err(|e| format!("Failed to read SaveGameInfo: {}", e))?;
        let current_main = fs::read_to_string(&main_save_path)
            .map_err(|e| format!("Failed to read main save file: {}", e))?;
        let restore_info = fs::read_to_string(&info_backup_path)
            .map_err(|e| format!("Failed to read backup SaveGameInfo: {}", e))?;
        let restore_main = fs::read_to_string(&main_backup_path)
            .map_err(|e| format!("Failed to read backup main save file: {}", e))?;

        let rollback_timestamp = current_backup_timestamp()?;
        create_backup_with_timestamp(&save_game_info_path, &current_info, rollback_timestamp)?;
        create_backup_with_timestamp(&main_save_path, &current_main, rollback_timestamp)?;

        fs::write(&save_game_info_path, restore_info)
            .map_err(|e| format!("Failed to restore SaveGameInfo: {}", e))?;
        fs::write(&main_save_path, restore_main)
            .map_err(|e| format!("Failed to restore main save file: {}", e))?;

        list_save_backups_sync(id)
    })
    .await
    .map_err(|e| format!("恢复存档备份任务失败: {}", e))?
}

#[tauri::command]
pub async fn delete_save_backup(id: String, timestamp: u64) -> Result<SaveBackupCatalog, String> {
    task::spawn_blocking(move || {
        let (save_folder, _, _) = ensure_save_paths(&id)?;
        let info_backup_path = save_folder.join(format!("SaveGameInfo.backup-{}", timestamp));
        let main_backup_path = save_folder.join(format!("{}.backup-{}", id, timestamp));
        let mut removed_any = false;

        for path in [&info_backup_path, &main_backup_path] {
            if path.exists() {
                fs::remove_file(path)
                    .map_err(|e| format!("Failed to delete backup {}: {}", path.display(), e))?;
                removed_any = true;
            }
        }

        if !removed_any {
            return Err("未找到要删除的备份文件。".to_string());
        }

        list_save_backups_sync(id)
    })
    .await
    .map_err(|e| format!("删除存档备份任务失败: {}", e))?
}
