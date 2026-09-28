use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Component, Path, PathBuf};

use typst_syntax::ast::{
    Arg, ArrayItem, AstNode, Expr, FuncCall, LetBinding, LetBindingKind, ModuleImport,
    ModuleInclude, Pattern,
};

#[derive(Debug, Default)]
pub struct DependencyManifest {
    pub paths: Vec<PathBuf>,
    pub complete: bool,
}

fn normalized_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = dunce::canonicalize(path) {
        return canonical;
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn resolve_raw_path(raw: &str, parent: &Path, project_root: &Path) -> Option<PathBuf> {
    if raw.starts_with('@') || raw.contains("://") {
        return None;
    }
    let raw_path = Path::new(raw);
    let joined = if raw_path.is_absolute() {
        if raw.starts_with('/') || raw.starts_with('\\') {
            project_root.join(raw.trim_start_matches(['/', '\\']))
        } else {
            raw_path.to_path_buf()
        }
    } else {
        parent.join(raw_path)
    };
    Some(normalized_path(&joined))
}

fn collect_expr_paths(
    expr: Expr<'_>,
    bindings: &HashMap<String, Vec<String>>,
    parent: &Path,
    project_root: &Path,
    paths: &mut Vec<PathBuf>,
) -> bool {
    match expr {
        Expr::Str(value) => {
            if let Some(path) = resolve_raw_path(value.get().as_str(), parent, project_root) {
                paths.push(path);
            }
            true
        }
        Expr::Ident(identifier) => {
            let Some(values) = bindings.get(identifier.as_str()) else {
                return false;
            };
            for raw in values {
                if let Some(path) = resolve_raw_path(raw, parent, project_root) {
                    paths.push(path);
                }
            }
            true
        }
        Expr::Parenthesized(group) => {
            collect_expr_paths(group.expr(), bindings, parent, project_root, paths)
        }
        Expr::Array(array) => {
            let mut complete = true;
            for item in array.items() {
                match item {
                    ArrayItem::Pos(expr) => {
                        complete &= collect_expr_paths(expr, bindings, parent, project_root, paths);
                    }
                    ArrayItem::Spread(_) => complete = false,
                }
            }
            complete
        }
        _ => false,
    }
}

fn scan_node(
    node: &typst_syntax::SyntaxNode,
    parent: &Path,
    project_root: &Path,
    bindings: &mut HashMap<String, Vec<String>>,
    paths: &mut Vec<PathBuf>,
    complete: &mut bool,
) {
    if let Some(binding) = LetBinding::from_untyped(node) {
        if let (
            LetBindingKind::Normal(Pattern::Normal(Expr::Ident(name))),
            Some(Expr::Str(value)),
        ) = (binding.kind(), binding.init())
        {
            let value = value.get().to_string();
            let values = bindings.entry(name.as_str().to_string()).or_default();
            if !values.contains(&value) {
                values.push(value);
            }
        }
    }

    if let Some(source) = ModuleInclude::from_untyped(node)
        .map(ModuleInclude::source)
        .or_else(|| ModuleImport::from_untyped(node).map(ModuleImport::source))
    {
        *complete &= collect_expr_paths(source, bindings, parent, project_root, paths);
    }

    if let Some(call) = FuncCall::from_untyped(node) {
        let tracked = match call.callee() {
            Expr::Ident(name) => matches!(
                name.as_str(),
                "image"
                    | "bibliography"
                    | "read"
                    | "csv"
                    | "json"
                    | "yaml"
                    | "toml"
                    | "xml"
                    | "cbor"
                    | "plugin"
            ),
            _ => false,
        };
        if tracked {
            match call.args().items().find_map(|arg| match arg {
                Arg::Pos(expr) => Some(expr),
                Arg::Named(_) => None,
                Arg::Spread(_) => None,
            }) {
                Some(expr) => {
                    *complete &= collect_expr_paths(expr, bindings, parent, project_root, paths);
                }
                None => *complete = false,
            }
        }
    }

    for child in node.children() {
        scan_node(&child, parent, project_root, bindings, paths, complete);
    }
}

fn scan_source(source: &str, source_path: &Path, project_root: &Path) -> DependencyManifest {
    let parent = source_path.parent().unwrap_or(project_root);
    let syntax = typst_syntax::parse(source);
    let mut paths = Vec::new();
    let mut complete = true;
    scan_node(
        &syntax,
        parent,
        project_root,
        &mut HashMap::new(),
        &mut paths,
        &mut complete,
    );
    paths.sort();
    paths.dedup();
    DependencyManifest { paths, complete }
}

pub fn collect_dependency_manifest(
    project_root: &Path,
    entry_file: &Path,
    overlays: &HashMap<PathBuf, String>,
) -> DependencyManifest {
    let project_root = normalized_path(project_root);
    let entry_file = normalized_path(entry_file);
    let overlays = overlays
        .iter()
        .map(|(path, text)| (normalized_path(path), text))
        .collect::<HashMap<_, _>>();
    let mut paths = HashSet::new();
    let mut pending = VecDeque::from([entry_file]);
    let mut complete = true;

    while let Some(path) = pending.pop_front() {
        let path = normalized_path(&path);
        if !path.starts_with(&project_root) {
            complete = false;
            continue;
        }
        if !paths.insert(path.clone())
            || path.extension().and_then(|extension| extension.to_str()) != Some("typ")
        {
            continue;
        }
        let source = overlays
            .get(&path)
            .map(|source| source.to_string())
            .or_else(|| fs::read_to_string(&path).ok());
        let Some(source) = source else {
            continue;
        };
        let scanned = scan_source(&source, &path, &project_root);
        complete &= scanned.complete;
        pending.extend(scanned.paths);
    }

    let mut paths = paths.into_iter().collect::<Vec<_>>();
    paths.sort();
    DependencyManifest { paths, complete }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_transitive_typst_and_resource_inputs_from_overlays() {
        let workspace = tempfile::tempdir().expect("workspace");
        let main = workspace.path().join("main.typ");
        let chapter = workspace.path().join("chapter.typ");
        let image = workspace.path().join("cover.png");
        fs::write(&main, "#include \"old.typ\"").expect("main");
        fs::write(&chapter, "#let cover = \"cover.png\"\n#image(cover)").expect("chapter");

        let overlays = HashMap::from([(
            normalized_path(&main),
            "#include \"chapter.typ\"".to_string(),
        )]);
        let manifest = collect_dependency_manifest(workspace.path(), &main, &overlays);

        assert!(manifest.complete);
        assert!(manifest.paths.contains(&normalized_path(&main)));
        assert!(manifest.paths.contains(&normalized_path(&chapter)));
        assert!(manifest.paths.contains(&normalized_path(&image)));
        assert!(!manifest
            .paths
            .contains(&normalized_path(&workspace.path().join("old.typ"))));
    }

    #[test]
    fn includes_missing_static_inputs_and_marks_dynamic_inputs_incomplete() {
        let workspace = tempfile::tempdir().expect("workspace");
        let main = workspace.path().join("main.typ");
        fs::write(
            &main,
            "#image(\"missing.png\")\n#let name = \"data.csv\"\n#csv(name)\n#read(computed)",
        )
        .expect("main");

        let manifest = collect_dependency_manifest(workspace.path(), &main, &HashMap::new());

        assert!(!manifest.complete);
        assert!(manifest
            .paths
            .contains(&normalized_path(&workspace.path().join("missing.png"))));
        assert!(manifest
            .paths
            .contains(&normalized_path(&workspace.path().join("data.csv"))));
    }
}
