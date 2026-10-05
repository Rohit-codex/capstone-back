import re

path = 'C:/Users/ris15/Desktop/dastavezai-web/backend/server/controllers/chatController.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the findBestTemplate predefined answer
start_marker = "const best = await findBestTemplate(message);"
end_marker = "return await replyWithText(res, response, user, req);\n    }"
if start_marker in content and end_marker in content:
    start_idx = content.find(start_marker)
    end_idx = content.find(end_marker) + len(end_marker)
    content = content[:start_idx] + content[end_idx:]
    print("Removed predefined findBestTemplate response.")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)