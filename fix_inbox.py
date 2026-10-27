import re

# Fix inbox.html
with open('c:/Users/dream4net/Desktop/FeedTheAnimalsMap/inbox.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the line with -webkit-line-clamp and add standard property
# The CSS is on a single line, so we need to add the standard property after it
content = re.sub(
    r'(-webkit-line-clamp:\s*\d+;)([^;}]*)',
    lambda m: m.group(1) + m.group(2).strip() + 'line-clamp: 2;',
    content
)

with open('c:/Users/dream4net/Desktop/FeedTheAnimalsMap/inbox.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed inbox.html')
print(f'  - Count of -webkit-line-clamp: {content.count("-webkit-line-clamp")}')
print(f'  - Count of line-clamp: {content.count("line-clamp:")}')
