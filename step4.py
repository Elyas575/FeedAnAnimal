path = r"C:\Users\dream4net\Desktop\FeedTheAnimalsMap\about.html"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# The old keeping section
old_keeping = '''  <section>
    <p class="kicker" data-i18n="about.keeping">Keeping this running</p>
  <p class="small" data-i18n="about.keeping_copy"> This platform is completely free to use, but hosting servers, running map services, and storing photos come with monthly costs. It’s built and maintained by just one person so any contribution, big or small,   helps keep the map live.    </p>
  <div class="btn-row">
    <a class="btn-love" href="support.html"><span class="material-symbols-outlined">favorite</span><span data-i18n="about.support_btn">Support</span></a>
    
  </div>

  <p class="ps" data-i18n="about.ps">P.S. Questions, feedback, or just want to say hi: lirzqad@gmail.com. I read everything myself.</p>
  </section>'''

new_support = '''  <section style="text-align:center;background:#fff;border:1px solid #efe6e4;border-radius:16px;padding:24px 20px;margin:8px 0">
    <p style="font-size:18px;font-weight:800;color:#1c1917;margin:0 0 6px">Keeping this running</p>
    <p style="font-size:14px;color:#57534e;margin:0 0 16px;line-height:1.6">
      StrayFeedingMap is free for everyone. Hosting, map tiles, and storage cost real money  built and maintained by one person.
    </p>
    <a class="btn-love" href="support.html" style="font-size:15px;padding:12px 28px"><span class="material-symbols-outlined">favorite</span>Support the map</a>
    <p style="font-size:12px;color:#8b7269;margin:10px 0 0">Every contribution, big or small, keeps the map live.</p>
  </section>

  <p class="ps" data-i18n="about.ps">P.S. Questions, feedback, or just want to say hi: lirzqad@gmail.com. I read everything myself.</p>'''

assert old_keeping in content, "old_keeping not found"
content = content.replace(old_keeping, new_support)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Step 4 done")