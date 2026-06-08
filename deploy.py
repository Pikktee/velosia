#!/usr/bin/env python3
import argparse
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

    # Set up argument parser
    parser = argparse.ArgumentParser(description="Vintamie Deploy Tool")
    parser.add_argument("--local", action="store_true", help="Deploy directly from the local machine using Railway CLI")
    parser.add_argument("version", nargs="?", help="New version to deploy (e.g. 2.0.3)")
    parser.add_argument("message", nargs="?", help="Commit/release message")
    args = parser.parse_args()

    # Determine new version
    new_version = args.version or next_version
    if not args.version:
        try:
            user_input = input(f"Enter new version [default: {next_version}]: ").strip()
            if user_input:
                new_version = user_input
        except (KeyboardInterrupt, EOFError):
            pass

    # Determine commit message
    default_msg = f"Release {new_version}"
    commit_msg = args.message or default_msg
    if not args.message:
        try:
            user_input = input(f"Enter release message [default: {default_msg}]: ").strip()
            if user_input:
                commit_msg = user_input
        except (KeyboardInterrupt, EOFError):
            pass
        
    print(f"\n---> Deploying version: {new_version}")
    print(f"---> Commit message: {commit_msg}")
    print(f"---> Target: {'Local CLI' if args.local else 'GitHub Actions'}\n")

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

    # 5b. Update android/app/build.gradle version
    android_gradle_path = "android/app/build.gradle"
    if os.path.exists(android_gradle_path):
        with open(android_gradle_path, "r") as f:
            content = f.read()
        
        # Replace versionName
        content = re.sub(r'versionName "[^"]+"', f'versionName "{new_version}"', content)
        
        # Increment versionCode
        version_code_match = re.search(r'versionCode (\d+)', content)
        if version_code_match:
            new_code = int(version_code_match.group(1)) + 1
            content = re.sub(r'versionCode \d+', f'versionCode {new_code}', content)
            
        with open(android_gradle_path, "w") as f:
            f.write(content)
        print("✔ Updated android/app/build.gradle version.")

    # 6. Git commit & push
    run_cmd("git add .")
    run_cmd(f'git commit -m "{commit_msg}"')
    run_cmd("git push")
    print("✔ Committed and pushed version changes to GitHub.")

    # 7. Railway Deployments
    if args.local:
        print("\n---> Uploading & deploying to Railway backend locally...")
        run_cmd("railway up --service backend --path-as-root --detach backend")
        print(f"Backend deployment initiated.")
        
        print("\n---> Uploading & deploying to Railway frontend locally...")
        run_cmd("railway up --service frontend --path-as-root --detach frontend")
        print(f"Frontend deployment initiated.")
        
        print("\n🎉 Deployment successfully initiated locally! Monitor the builds in your Railway dashboard:")
        print("https://railway.app/project/42d17b5d-61c9-4921-a21f-582d9a4c1d8a")
    else:
        print("\n🎉 Code pushed to GitHub! GitHub Actions will now automatically build and deploy this release.")
        print("Monitor the build on GitHub: https://github.com/Pikktee/vintamie/actions")
        print("Or check your Railway dashboard: https://railway.app/project/42d17b5d-61c9-4921-a21f-582d9a4c1d8a")

if __name__ == "__main__":
    main()
