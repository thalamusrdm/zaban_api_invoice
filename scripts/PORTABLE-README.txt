Zaban Invoice Server - Portable Windows x64
==========================================

1. Extract ALL files from the ZIP to a new folder on the server.
   Do not run start-server.bat from inside the ZIP.
2. A configured package already contains .env. Otherwise copy your existing
   .env into this folder, or copy .env.example to .env and fill in the settings.
3. Double-click start-server.bat. Keep its CMD window open.
4. On the server open http://localhost:18473
   On another authorized computer open http://SERVER-IP:18473
5. Close the CMD window or press Ctrl+C to stop the server.

Node.js is bundled in runtime/node.exe. All dependencies are in node_modules.
No Node.js/npm installation, administrator setup, service or PATH change is needed.
The launcher runs the server directly in the visible CMD window.

UPDATING AN EXISTING SERVER:
Close its old server window first. Extract this release into a NEW folder,
copy the server's existing .env there to preserve its connection settings,
then run the new start-server.bat. Keep the old folder for rollback.
No change to the existing firewall rules is required for the same port.
The server still needs network access to Priority and Bank of Israel.

This Windows x64 runtime requires Windows 10 / Windows Server 2016 or newer.
https://github.com/nodejs/node/blob/v24.15.0/BUILDING.md#platform-list
The runtime distribution license is in runtime/LICENSE.txt.
Dependency licenses remain in their node_modules package folders.

A configured ZIP contains Priority connection credentials in .env.
Keep it private, and do not upload it to Git or share it publicly.
