#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys

def run_cmd(cmd, cwd=None):
    print(f"Running: {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error: {res.stderr}")
        sys.exit(res.returncode)
    return res.stdout.strip()

def main():
    # 1. Get current version
    version_file = "VERSION"
    if not os.path.exists(version_file):
        current_version = "2.0.0"
        with open(version_file, "w") as f:
            f.write(current_version)
    else:
        with open(version_file, "r") as f:
            current_version = f.read().strip()

    print(f"Current version: {current_version}")
    
    # Calculate next patch version
    parts = current_version.split('.')
    if len(parts) == 3:
        next_version = f"{parts[0]}.{parts[1]}.{int(parts[2])+1}"
    else:
        next_version = current_version + ".1"

    # Support command line inputs or prompt if interactive
    new_version = next_version
    commit_msg = f"Release {new_version}"
    
    # Check if arguments are passed
    if len(sys.argv) > 1:
        new_version = sys.argv[1]
    else:
        # If running in interactive terminal (user running it manually)
        try:
            user_input = input(f"Enter new version [default: {next_version}]: ").strip()
            if user_input:
                new_version = user_input
        except (KeyboardInterrupt, EOFError):
            pass

    if len(sys.argv) > 2:
        commit_msg = sys.argv[2]
    else:
        try:
            user_input = input(f"Enter release message [default: Release {new_version}]: ").strip()
            if user_input:
                commit_msg = user_input
        except (KeyboardInterrupt, EOFError):
            pass
        
    print(f"\n---> Deploying version: {new_version}")
    print(f"---> Commit message: {commit_msg}\n")

    # 2. Write new version file
    with open(version_file, "w") as f:
        f.write(new_version)

    # 3. Update backend/main.py
    main_py_path = "backend/main.py"
    if os.path.exists(main_py_path):
        with open(main_py_path, "r") as f:
            content = f.read()
        content = re.sub(r'version="[^"]+"', f'version="{new_version}"', content)
        with open(main_py_path, "w") as f:
            f.write(content)
        print("✔ Updated backend/main.py version.")

    # 4. Update frontend/package.json
    pkg_json_path = "frontend/package.json"
    if os.path.exists(pkg_json_path):
        with open(pkg_json_path, "r") as f:
            data = json.load(f)
        data["version"] = new_version
        with open(pkg_json_path, "w") as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        print("✔ Updated frontend/package.json version.")

    # 5. Update extension/manifest.json
    manifest_path = "extension/manifest.json"
    if os.path.exists(manifest_path):
        with open(manifest_path, "r") as f:
            data = json.load(f)
        data["version"] = new_version
        with open(manifest_path, "w") as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        print("✔ Updated extension/manifest.json version.")

    # 6. Git commit & push
    run_cmd("git add .")
    run_cmd(f'git commit -m "{commit_msg}"')
    run_cmd("git push")
    print("✔ Committed and pushed version changes to GitHub.")

    # 7. Railway Deployments
    print("\n---> Uploading & deploying to Railway backend...")
    backend_res = run_cmd("railway up --service backend --detach backend")
    print(f"Backend deployment initiated.")
    
    print("\n---> Uploading & deploying to Railway frontend...")
    frontend_res = run_cmd("railway up --service frontend --detach frontend")
    print(f"Frontend deployment initiated.")
    
    print("\n🎉 Deployment successfully initiated! Monitor the builds in your Railway dashboard:")
    print("https://railway.app/project/42d17b5d-61c9-4921-a21f-582d9a4c1d8a")

if __name__ == "__main__":
    main()
