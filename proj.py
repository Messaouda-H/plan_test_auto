import os

# ============================================================
# CONFIGURATION — adapte ces valeurs à ton projet
# ============================================================
ROOT_DIR = "."           # Dossier racine de ton projet
OUTPUT_FILE = "project_dump.txt"

# Extensions à inclure
INCLUDE_EXTENSIONS = {
    ".py", ".txt", ".md", ".json", ".yaml", ".yml",
    ".toml", ".cfg", ".ini", ".bat", ".ps1", ".sh"
}

# Dossiers à ignorer complètement
IGNORE_DIRS = {
    "__pycache__", ".git", ".idea", ".vscode",
    "venv", "venv_halyzia", ".mypy_cache", "dist",
    "build", "*.egg-info", "node_modules"
}

# Fichiers à ignorer
IGNORE_FILES = {
    "project_dump.txt", ".gitignore", ".DS_Store"
}
# ============================================================

def should_ignore_dir(dirname):
    return dirname in IGNORE_DIRS or dirname.endswith(".egg-info")

def dump_project(root_dir, output_file):
    file_count = 0
    total_lines = 0

    with open(output_file, "w", encoding="utf-8") as out:
        out.write(f"# PROJECT DUMP — {os.path.abspath(root_dir)}\n")
        out.write("=" * 80 + "\n\n")

        for dirpath, dirnames, filenames in os.walk(root_dir):
            # Filtre les dossiers ignorés (modifie en place pour os.walk)
            dirnames[:] = [d for d in dirnames if not should_ignore_dir(d)]

            for filename in sorted(filenames):
                if filename in IGNORE_FILES:
                    continue
                ext = os.path.splitext(filename)[1].lower()
                if ext not in INCLUDE_EXTENSIONS:
                    continue

                filepath = os.path.join(dirpath, filename)
                relative_path = os.path.relpath(filepath, root_dir)

                try:
                    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                    lines = content.count("\n")
                    total_lines += lines
                    file_count += 1

                    out.write(f"{'=' * 80}\n")
                    out.write(f"FILE: {relative_path}  ({lines} lignes)\n")
                    out.write(f"{'=' * 80}\n")
                    out.write(content)
                    out.write("\n\n")

                except Exception as e:
                    out.write(f"[ERREUR lecture: {e}]\n\n")

        out.write("=" * 80 + "\n")
        out.write(f"TOTAL: {file_count} fichiers | {total_lines} lignes\n")

    print(f"✅ Dump généré : {output_file}")
    print(f"   {file_count} fichiers | {total_lines} lignes")
    print(f"   Taille : {os.path.getsize(output_file) / 1024 / 1024:.2f} MB")

dump_project(ROOT_DIR, OUTPUT_FILE)