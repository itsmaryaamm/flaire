# Put Flaire on GitHub (10 minutes)

You need: a free GitHub account (github.com) and Git for Windows (https://git-scm.com, accept the defaults).

1. On github.com click **New repository**. Name it `flaire`. Choose **Public**. Do NOT tick "Add a README". Click Create.
2. Unzip the new flaire.zip. Delete the old `flaire-data` folder if it is inside, it holds private test data.
3. Open PowerShell inside the unzipped folder (click the folder address bar, type `powershell`, Enter).
4. Put your GitHub username into the files (replace your-github-username):
   ```
   node scripts/set-github-user.js your-github-username
   ```
5. Send it to GitHub:
   ```
   git init -b main
   git add .
   git status
   ```
   Read the list from `git status`. It must NOT contain `flaire-data`, `secret.key`, `lithic-cards.json` or `.env`.
   If it does, stop and ask me. Otherwise continue:
   ```
   git commit -m "Flaire v0.2"
   git remote add origin https://github.com/your-github-username/flaire.git
   git push -u origin main
   ```
   A browser window opens to sign in to GitHub the first time.
6. Test it like a stranger would, in a new PowerShell window:
   ```
   npm install -g github:your-github-username/flaire
   flaire demo
   ```
7. On the GitHub page, add a short description and topics (ai-agents, mcp, saudi, spend-controls).

## Rules before you share the link
* Never put a Lithic key, even a sandbox one, in any file you commit. Keys only go in the terminal session or your MCP client config.
* Keep the README line that says it is an early, sandbox-only, not security audited version.
* Check the name "Flaire" for trademark and domain conflicts before promoting it.
