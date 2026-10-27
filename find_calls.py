with open('c:/Users/dream4net/Desktop/FeedTheAnimalsMap/index.js', 'r', encoding='utf-8') as f:
    content = f.read()
import re
for m in re.finditer(r'sbLoadReports\s*\(', content):
    start = max(0, m.start()-100)
    end = min(len(content), m.end()+100)
    print('--- sbLoadReports at', m.start(), '---')
    print(content[start:end])
    print()
for m in re.finditer(r'sbLoadRecentEvents\s*\(', content):
    start = max(0, m.start()-100)
    end = min(len(content), m.end()+100)
    print('--- sbLoadRecentEvents at', m.start(), '---')
    print(content[start:end])
    print()