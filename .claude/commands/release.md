Review all changes since the last commit (use `git diff HEAD` and `git log`) and perform the following:

1. **Update CHANGES.md**: Add a new version section with a concise list of new/changed features. Follow the existing format (bullet points, short descriptions). Increment the version number appropriately (patch for fixes, minor for features).

2. **Document complex features**: If any new feature is architecturally significant or has non-obvious behavior, create or update a doc in `doc/` explaining it. Simple UI tweaks or bug fixes do not need documentation.

3. **Commit**: Stage CHANGES.md, any new/updated doc files, and all related source changes. Write a clear commit message summarizing the release.

Do NOT push to remote. Show me the commit message before committing.
