path = r"C:\Users\dream4net\Desktop\FeedTheAnimalsMap\about.html"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# The support section (prominent) that's currently after FAQ
support_section = '''  <section style="text-align:center;background:#fff;border:1px solid #efe6e4;border-radius:16px;padding:24px 20px;margin:8px 0">
    <p style="font-size:18px;font-weight:800;color:#1c1917;margin:0 0 6px">Keeping this running</p>
    <p style="font-size:14px;color:#57534e;margin:0 0 16px;line-height:1.6">
      StrayFeedingMap is free for everyone. Hosting, map tiles, and storage cost real money  built and maintained by one person.
    </p>
    <a class="btn-love" href="support.html" style="font-size:15px;padding:12px 28px"><span class="material-symbols-outlined">favorite</span>Support the map</a>
    <p style="font-size:12px;color:#8b7269;margin:10px 0 0">Every contribution, big or small, keeps the map live.</p>
  </section>'''

assert support_section in content, "support_section not found"

# Remove it from current position
content = content.replace(support_section, '', 1)

# Insert it right after "How to use it" section
how_to_use = '''  <section>
    <p class="kicker">How to use it</p>
    <ol style="margin:12px 0 0;padding:0 0 0 28px;font-size:15.5px;line-height:1.8;color:#44403c;list-style:decimal">
      <li><b>Allow location</b> click "Allow" when the browser asks.</li>
      <li><b>Log in</b> sign in to your account.</li>
      <li><b>Report a stray</b> tap the orange button, upload a photo, tick what they need, save.</li>
      <li><b>Feed or water</b> tap any pin, then "I Fed" or "I Watered".</li>
      <li><b>Done!</b> the pin updates for everyone.</li>
    </ol>
  </section>'''

assert how_to_use in content, "how_to_use not found"

# Insert support section after how_to_use
content = content.replace(how_to_use, how_to_use + '\n\n' + support_section, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Step 5 done")