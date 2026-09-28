use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

const MAX_WORKSPACE_PATHS: usize = 20_000;
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif",
];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathEntry {
    path: String,
    is_directory: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedWorkspaceFile {
    destination_path: String,
    reference_path: String,
    kind: String,
    final_stem: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathTransfer {
    pub source_path: String,
    pub destination_path: String,
}

fn normalized_transfer_path(root: &Path, path: &str, source: bool) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err("Workspace transfers require absolute paths.".to_string());
    }
    if source {
        let metadata = std::fs::symlink_metadata(candidate)
            .map_err(|error| format!("Failed to inspect '{}': {error}", candidate.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Symbolic links cannot be transferred: '{}'.",
                candidate.display()
            ));
        }
        let canonical = dunce::canonicalize(candidate)
            .map_err(|error| format!("Failed to resolve '{}': {error}", candidate.display()))?;
        if canonical == root || !canonical.starts_with(root) {
            return Err("Transfer sources must be entries inside the project root.".to_string());
        }
        return Ok(canonical);
    }

    if candidate.exists() {
        return Err(format!(
            "The destination already exists: '{}'.",
            candidate.display()
        ));
    }
    let parent = candidate
        .parent()
        .ok_or_else(|| "The destination has no parent directory.".to_string())?;
    let canonical_parent = dunce::canonicalize(parent).map_err(|error| {
        format!(
            "Failed to resolve destination directory '{}': {error}",
            parent.display()
        )
    })?;
    if !canonical_parent.starts_with(root) {
        return Err("Transfer destinations must remain inside the project root.".to_string());
    }
    let name = candidate
        .file_name()
        .ok_or_else(|| "The destination has no filename.".to_string())?;
    Ok(canonical_parent.join(name))
}

fn validate_transfers(
    workspace_root_path: &str,
    transfers: &[WorkspacePathTransfer],
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    if transfers.is_empty() {
        return Err("At least one workspace entry is required.".to_string());
    }
    let root = canonical_directory(Path::new(workspace_root_path), "project root")?;
    let mut validated = Vec::with_capacity(transfers.len());
    let mut sources = HashSet::new();
    let mut destinations = HashSet::new();
    for transfer in transfers {
        let source = normalized_transfer_path(&root, &transfer.source_path, true)?;
        let destination = normalized_transfer_path(&root, &transfer.destination_path, false)?;
        if source == destination {
            return Err("Moving an entry to its current location is not necessary.".to_string());
        }
        if source.is_dir() && destination.starts_with(&source) {
            return Err("A folder cannot be moved or copied into itself.".to_string());
        }
        if !sources.insert(source.clone()) || !destinations.insert(destination.clone()) {
            return Err("Workspace transfer paths must be unique.".to_string());
        }
        validated.push((source, destination));
    }
    for (index, (source, _)) in validated.iter().enumerate() {
        if validated
            .iter()
            .enumerate()
            .any(|(other_index, (other, _))| index != other_index && source.starts_with(other))
        {
            return Err(
                "A transfer cannot contain both a folder and one of its descendants.".to_string(),
            );
        }
    }
    Ok(validated)
}

fn copy_path_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|error| format!("Failed to inspect '{}': {error}", source.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Symbolic links cannot be copied: '{}'.",
            source.display()
        ));
    }
    if metadata.is_file() {
        std::fs::copy(source, destination)
            .map(|_| ())
            .map_err(|error| format!("Failed to copy '{}': {error}", source.display()))
    } else if metadata.is_dir() {
        std::fs::create_dir(destination)
            .map_err(|error| format!("Failed to create '{}': {error}", destination.display()))?;
        let mut entries = std::fs::read_dir(source)
            .map_err(|error| format!("Failed to read '{}': {error}", source.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Failed to read '{}': {error}", source.display()))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            copy_path_recursive(&entry.path(), &destination.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        Err(format!(
            "Unsupported workspace entry: '{}'.",
            source.display()
        ))
    }
}

#[tauri::command]
pub fn move_workspace_entries(
    workspace_root_path: String,
    transfers: Vec<WorkspacePathTransfer>,
) -> Result<Vec<WorkspacePathTransfer>, String> {
    let validated = validate_transfers(&workspace_root_path, &transfers)?;
    let mut completed: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (source, destination) in &validated {
        if let Err(error) = std::fs::rename(source, destination) {
            for (moved_source, moved_destination) in completed.iter().rev() {
                let _ = std::fs::rename(moved_destination, moved_source);
            }
            return Err(format!("Failed to move '{}': {error}", source.display()));
        }
        completed.push((source.clone(), destination.clone()));
    }
    Ok(transfers)
}

#[tauri::command]
pub fn copy_workspace_entries(
    workspace_root_path: String,
    transfers: Vec<WorkspacePathTransfer>,
) -> Result<Vec<WorkspacePathTransfer>, String> {
    let validated = validate_transfers(&workspace_root_path, &transfers)?;
    let mut completed: Vec<PathBuf> = Vec::new();
    for (source, destination) in &validated {
        if let Err(error) = copy_path_recursive(source, destination) {
            if destination.is_dir() {
                let _ = std::fs::remove_dir_all(destination);
            } else {
                let _ = std::fs::remove_file(destination);
            }
            for created in completed.iter().rev() {
                if created.is_dir() {
                    let _ = std::fs::remove_dir_all(created);
                } else {
                    let _ = std::fs::remove_file(created);
                }
            }
            return Err(error);
        }
        completed.push(destination.clone());
    }
    Ok(transfers)
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = dunce::canonicalize(path)
        .map_err(|error| format!("Failed to resolve {label} '{}': {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("The {label} is not a directory."));
    }
    Ok(canonical)
}

fn path_components(path: &Path) -> Vec<OsString> {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_os_string()),
            _ => None,
        })
        .collect()
}

fn relative_reference(root: &Path, from_directory: &Path, target: &Path) -> Result<String, String> {
    let from = from_directory
        .strip_prefix(root)
        .map_err(|_| "The active file is outside the project.".to_string())?;
    let to = target
        .strip_prefix(root)
        .map_err(|_| "The target file is outside the project.".to_string())?;
    let from_components = path_components(from);
    let to_components = path_components(to);
    let common = from_components
        .iter()
        .zip(to_components.iter())
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts = vec!["..".to_string(); from_components.len().saturating_sub(common)];
    parts.extend(
        to_components[common..]
            .iter()
            .map(|component| component.to_string_lossy().to_string()),
    );
    let joined = parts.join("/");
    if joined.is_empty() {
        Ok("./".to_string())
    } else if joined == ".." || joined.starts_with("../") {
        Ok(joined)
    } else {
        Ok(format!("./{joined}"))
    }
}

fn ignored_directory(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target")
}

fn collect_workspace_paths(
    root: &Path,
    current_directory: &Path,
    directory: &Path,
    results: &mut Vec<WorkspacePathEntry>,
) -> Result<(), String> {
    if results.len() >= MAX_WORKSPACE_PATHS {
        return Ok(());
    }
    let mut entries = std::fs::read_dir(directory)
        .map_err(|error| {
            format!(
                "Failed to read project directory '{}': {error}",
                directory.display()
            )
        })?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    for entry in entries {
        if results.len() >= MAX_WORKSPACE_PATHS {
            break;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if file_type.is_dir() {
            if ignored_directory(&name) {
                continue;
            }
            let mut reference = relative_reference(root, current_directory, &path)?;
            if !reference.ends_with('/') {
                reference.push('/');
            }
            results.push(WorkspacePathEntry {
                path: reference,
                is_directory: true,
            });
            collect_workspace_paths(root, current_directory, &path, results)?;
        } else if file_type.is_file() {
            results.push(WorkspacePathEntry {
                path: relative_reference(root, current_directory, &path)?,
                is_directory: false,
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_workspace_paths(
    workspace_root_path: String,
    current_file_path: String,
) -> Result<Vec<WorkspacePathEntry>, String> {
    let root = canonical_directory(Path::new(&workspace_root_path), "project root")?;
    let current_file = dunce::canonicalize(&current_file_path)
        .map_err(|error| format!("Failed to resolve active file: {error}"))?;
    if !current_file.starts_with(&root) || !current_file.is_file() {
        return Err("The active file must be an existing file inside the project.".to_string());
    }
    let current_directory = current_file
        .parent()
        .ok_or_else(|| "The active file has no parent directory.".to_string())?;
    let mut results = Vec::new();
    collect_workspace_paths(&root, current_directory, &root, &mut results)?;
    Ok(results)
}
fn collect_workspace_typst_files(
    directory: &Path,
    results: &mut Vec<String>,
) -> Result<(), String> {
    if results.len() >= MAX_WORKSPACE_PATHS {
        return Ok(());
    }
    let mut entries = std::fs::read_dir(directory)
        .map_err(|error| {
            format!(
                "Failed to read project directory '{}': {error}",
                directory.display()
            )
        })?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
    for entry in entries {
        if results.len() >= MAX_WORKSPACE_PATHS {
            break;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() {
            if !ignored_directory(&name) {
                collect_workspace_typst_files(&path, results)?;
            }
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("typ"))
        {
            results.push(path.to_string_lossy().to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_workspace_typst_files(workspace_root_path: String) -> Result<Vec<String>, String> {
    let root = canonical_directory(Path::new(&workspace_root_path), "project root")?;
    let mut results = Vec::new();
    collect_workspace_typst_files(&root, &mut results)?;
    Ok(results)
}

fn validated_destination(
    root: &Path,
    current_file: &Path,
    configured: Option<&str>,
) -> Result<PathBuf, String> {
    let configured = configured.map(str::trim).filter(|value| !value.is_empty());
    let destination = if let Some(configured) = configured {
        let relative = Path::new(configured);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
        {
            return Err(
                "The drop destination must be a project-relative directory without '..'."
                    .to_string(),
            );
        }
        root.join(relative)
    } else {
        current_file
            .parent()
            .ok_or_else(|| "The active file has no parent directory.".to_string())?
            .to_path_buf()
    };
    std::fs::create_dir_all(&destination).map_err(|error| {
        format!(
            "Failed to create drop destination '{}': {error}",
            destination.display()
        )
    })?;
    let destination = canonical_directory(&destination, "drop destination")?;
    if !destination.starts_with(root) {
        return Err("The drop destination resolves outside the project.".to_string());
    }
    Ok(destination)
}

fn available_destination(
    directory: &Path,
    file_name: &Path,
    source: &Path,
) -> Result<PathBuf, String> {
    let initial = directory.join(file_name);
    if !initial.exists() || dunce::canonicalize(&initial).ok().as_deref() == Some(source) {
        return Ok(initial);
    }
    let stem = file_name.file_stem().unwrap_or_default().to_string_lossy();
    let extension = file_name.extension().map(|value| value.to_string_lossy());
    for index in 2..10_000 {
        let candidate_name = match extension.as_deref() {
            Some(extension) => format!("{stem}-{index}.{extension}"),
            None => format!("{stem}-{index}"),
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not find an available destination filename.".to_string())
}

fn normalized_stem(value: &str, fallback: &str) -> String {
    let mut result = String::new();
    let mut pending_separator = false;
    for character in value.chars() {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            if pending_separator && !result.is_empty() && !result.ends_with('_') {
                result.push('_');
            }
            result.push(character);
            pending_separator = false;
        } else if !result.is_empty() {
            pending_separator = true;
        }
    }
    let trimmed = result.trim_matches('_');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn dated_destination(
    directory: &Path,
    source: &Path,
    fallback: &str,
    date_stamp: &str,
) -> Result<PathBuf, String> {
    if date_stamp.len() != 10
        || !date_stamp.chars().enumerate().all(|(index, value)| {
            (matches!(index, 4 | 7) && value == '_')
                || (!matches!(index, 4 | 7) && value.is_ascii_digit())
        })
    {
        return Err("The structured-drop date must use yyyy_MM_dd format.".to_string());
    }
    let source_stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let stem = normalized_stem(source_stem, fallback);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    for index in 0..10_000 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("_{index}")
        };
        let candidate = directory.join(format!("{stem}_{date_stamp}{suffix}.{extension}"));
        if !candidate.exists() || dunce::canonicalize(&candidate).ok().as_deref() == Some(source) {
            return Ok(candidate);
        }
    }
    Err("Could not find an available dated destination filename.".to_string())
}

#[tauri::command]
pub fn import_dropped_workspace_file(
    source_path: String,
    workspace_root_path: String,
    current_file_path: String,
    destination_directory: Option<String>,
    structured: Option<bool>,
    date_stamp: Option<String>,
) -> Result<ImportedWorkspaceFile, String> {
    let root = canonical_directory(Path::new(&workspace_root_path), "project root")?;
    let source = dunce::canonicalize(&source_path)
        .map_err(|error| format!("Failed to resolve dropped file: {error}"))?;
    if !source.is_file() {
        return Err("Only individual files can be dropped into the editor.".to_string());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let kind = if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        "image"
    } else if extension == "pdf" {
        "document"
    } else {
        return Err("Only supported image files and PDF documents can be imported.".to_string());
    };
    let current_file = dunce::canonicalize(&current_file_path)
        .map_err(|error| format!("Failed to resolve active file: {error}"))?;
    if !current_file.starts_with(&root) || !current_file.is_file() {
        return Err("The active file must be an existing file inside the project.".to_string());
    }
    let destination_directory =
        validated_destination(&root, &current_file, destination_directory.as_deref())?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "The dropped file has no filename.".to_string())?;
    let destination = if structured.unwrap_or(false) {
        dated_destination(
            &destination_directory,
            &source,
            if kind == "image" { "image" } else { "document" },
            date_stamp.as_deref().unwrap_or(""),
        )?
    } else {
        available_destination(&destination_directory, Path::new(file_name), &source)?
    };
    if dunce::canonicalize(&destination).ok().as_deref() != Some(source.as_path()) {
        std::fs::copy(&source, &destination)
            .map_err(|error| format!("Failed to copy dropped file: {error}"))?;
    }
    let current_directory = current_file
        .parent()
        .ok_or_else(|| "The active file has no parent directory.".to_string())?;
    Ok(ImportedWorkspaceFile {
        destination_path: destination.to_string_lossy().to_string(),
        reference_path: relative_reference(&root, current_directory, &destination)?,
        kind: kind.to_string(),
        final_stem: destination
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_nested_files_relative_to_the_active_document() {
        let project = tempfile::tempdir().unwrap();
        let chapters = project.path().join("chapters");
        let front_matter = project.path().join("front_matter");
        std::fs::create_dir_all(&chapters).unwrap();
        std::fs::create_dir_all(&front_matter).unwrap();
        let current = chapters.join("chapter.typ");
        std::fs::write(&current, "Chapter").unwrap();
        std::fs::write(project.path().join("main.typ"), "Main").unwrap();
        std::fs::write(front_matter.join("title_page.typ"), "Title").unwrap();

        let paths = list_workspace_paths(
            project.path().to_string_lossy().to_string(),
            current.to_string_lossy().to_string(),
        )
        .unwrap();
        assert!(paths.iter().any(|entry| entry.path == "../main.typ"));
        assert!(paths
            .iter()
            .any(|entry| entry.path == "../front_matter/title_page.typ"));
    }
    #[test]
    fn lists_typst_sources_without_hidden_or_build_directories() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("chapters")).unwrap();
        std::fs::create_dir_all(project.path().join(".typsastra")).unwrap();
        std::fs::create_dir_all(project.path().join("target")).unwrap();
        std::fs::write(project.path().join("main.typ"), "Main").unwrap();
        std::fs::write(project.path().join("chapters/one.typ"), "One").unwrap();
        std::fs::write(project.path().join("chapters/image.png"), b"image").unwrap();
        std::fs::write(project.path().join(".typsastra/hidden.typ"), "Hidden").unwrap();
        std::fs::write(project.path().join("target/generated.typ"), "Generated").unwrap();

        let files =
            list_workspace_typst_files(project.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|path| path.ends_with("main.typ")));
        assert!(files.iter().any(|path| path.ends_with("chapters/one.typ")));
    }

    #[test]
    fn imports_without_overwriting_and_rejects_project_escape() {
        let project = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let current = project.path().join("main.typ");
        let source = external.path().join("figure.png");
        std::fs::write(&current, "Main").unwrap();
        std::fs::write(&source, b"image").unwrap();

        let first = import_dropped_workspace_file(
            source.to_string_lossy().to_string(),
            project.path().to_string_lossy().to_string(),
            current.to_string_lossy().to_string(),
            Some("assets/images".to_string()),
            None,
            None,
        )
        .unwrap();
        let second = import_dropped_workspace_file(
            source.to_string_lossy().to_string(),
            project.path().to_string_lossy().to_string(),
            current.to_string_lossy().to_string(),
            Some("assets/images".to_string()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(first.reference_path, "./assets/images/figure.png");
        assert_eq!(second.reference_path, "./assets/images/figure-2.png");
        assert!(import_dropped_workspace_file(
            source.to_string_lossy().to_string(),
            project.path().to_string_lossy().to_string(),
            current.to_string_lossy().to_string(),
            Some("../outside".to_string()),
            None,
            None,
        )
        .is_err());
    }

    #[test]
    fn moves_multiple_entries_and_cancels_the_batch_on_collision() {
        let project = tempfile::tempdir().unwrap();
        let destination = project.path().join("destination");
        std::fs::create_dir(&destination).unwrap();
        let first = project.path().join("first.typ");
        let second = project.path().join("second.typ");
        std::fs::write(&first, "first").unwrap();
        std::fs::write(&second, "second").unwrap();

        move_workspace_entries(
            project.path().to_string_lossy().to_string(),
            vec![
                WorkspacePathTransfer {
                    source_path: first.to_string_lossy().to_string(),
                    destination_path: destination.join("first.typ").to_string_lossy().to_string(),
                },
                WorkspacePathTransfer {
                    source_path: second.to_string_lossy().to_string(),
                    destination_path: destination.join("second.typ").to_string_lossy().to_string(),
                },
            ],
        )
        .unwrap();
        assert!(destination.join("first.typ").exists());
        assert!(destination.join("second.typ").exists());

        let third = project.path().join("third.typ");
        let fourth = project.path().join("fourth.typ");
        std::fs::write(&third, "third").unwrap();
        std::fs::write(&fourth, "fourth").unwrap();
        std::fs::write(destination.join("fourth.typ"), "collision").unwrap();
        let result = move_workspace_entries(
            project.path().to_string_lossy().to_string(),
            vec![
                WorkspacePathTransfer {
                    source_path: third.to_string_lossy().to_string(),
                    destination_path: destination.join("third.typ").to_string_lossy().to_string(),
                },
                WorkspacePathTransfer {
                    source_path: fourth.to_string_lossy().to_string(),
                    destination_path: destination.join("fourth.typ").to_string_lossy().to_string(),
                },
            ],
        );
        assert!(result.is_err());
        assert!(third.exists());
        assert!(fourth.exists());
        assert!(!destination.join("third.typ").exists());
    }

    #[test]
    fn recursively_copies_folders_without_overwriting() {
        let project = tempfile::tempdir().unwrap();
        let source = project.path().join("assets");
        std::fs::create_dir_all(source.join("nested")).unwrap();
        std::fs::write(source.join("nested/image.png"), b"image").unwrap();
        let destination = project.path().join("assets copy");
        copy_workspace_entries(
            project.path().to_string_lossy().to_string(),
            vec![WorkspacePathTransfer {
                source_path: source.to_string_lossy().to_string(),
                destination_path: destination.to_string_lossy().to_string(),
            }],
        )
        .unwrap();
        assert_eq!(
            std::fs::read(destination.join("nested/image.png")).unwrap(),
            b"image"
        );
        assert!(copy_workspace_entries(
            project.path().to_string_lossy().to_string(),
            vec![WorkspacePathTransfer {
                source_path: source.to_string_lossy().to_string(),
                destination_path: destination.to_string_lossy().to_string(),
            }],
        )
        .is_err());
    }

    #[test]
    fn structured_imports_use_normalized_dated_names_and_underscore_collisions() {
        let project = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let current = project.path().join("main.typ");
        let source = external.path().join("Résumé figure!!.png");
        std::fs::write(&current, "Main").unwrap();
        std::fs::write(&source, b"image").unwrap();
        let first = import_dropped_workspace_file(
            source.to_string_lossy().to_string(),
            project.path().to_string_lossy().to_string(),
            current.to_string_lossy().to_string(),
            Some("images".to_string()),
            Some(true),
            Some("2026_08_02".to_string()),
        )
        .unwrap();
        let second = import_dropped_workspace_file(
            source.to_string_lossy().to_string(),
            project.path().to_string_lossy().to_string(),
            current.to_string_lossy().to_string(),
            Some("images".to_string()),
            Some(true),
            Some("2026_08_02".to_string()),
        )
        .unwrap();
        assert_eq!(
            first.reference_path,
            "./images/Résumé_figure_2026_08_02.png"
        );
        assert_eq!(
            second.reference_path,
            "./images/Résumé_figure_2026_08_02_1.png"
        );
        assert_eq!(second.final_stem, "Résumé_figure_2026_08_02_1");
    }
}
