with open('c:/Users/dream4net/Desktop/FeedTheAnimalsMap/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find all id attributes
import re
ids = re.findall(r'id="([^"]+)"', content)
for idname in ids:
    if any(k in idname.lower() for k in ['feed', 'animal', 'list', 'sidebar']):
        print(idname)

# Find renderFeed in index.js to understand the container
with open('c:/Users/dream4net/Desktop/FeedTheAnimalsMap/index.js', 'r', encoding='utf-8') as f:
    js = f.read()
idx = js.find('function renderFeed')
if idx != -1:
    print('\\nrenderFeed found at', idx)
    print(js[idx:idx+500])