with open('c:/Users/dream4net/Desktop/FeedTheAnimalsMap/cities.html', 'r', encoding='utf-8') as f:
    content = f.read()
idx = content.find('id="list"')
if idx != -1:
    print(content[idx-50:idx+200])