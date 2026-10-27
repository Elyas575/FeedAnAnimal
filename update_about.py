import re

path = r"C:\Users\dream4net\Desktop\FeedTheAnimalsMap\about.html"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find the section starting with "How to report a stray" and ending before "How to help"
old_start = content.find('    <p class="kicker">How to report a stray (3 steps)</p>')
old_end = content.find('    <p class="kicker" data-i18n="about.help">How to help</p>')

if old_start == -1 or old_end == -1:
    print(f"Could not find sections: start={old_start}, end={old_end}")
else:
    new_sections = '''    <p class="kicker">How to add to the map</p>
    <ol style="margin:12px 0 0;padding:0 0 0 24px;font-size:15.5px;line-height:1.8;color:#44403c">
      <li><b>Log in</b>  sign in to your account first.</li>
      <li><b>Click "Report a Stray"</b>  tap the orange button on the map.</li>
      <li><b>Upload a photo</b>  add a picture of the animal.</li>
      <li><b>Your location is detected</b>  the map pins your exact spot automatically.</li>
      <li><b>Tick what they need</b>  food, water, or medical care.</li>
      <li><b>Write a note</b>  describe the animal, its condition, or anything helpful.</li>
      <li><b>Click "Save to Map"</b>  the stray goes live for everyone!</li>
    </ol>
  </section>

  <section>
    <p class="kicker">How to feed or water an animal</p>
    <ol style="margin:12px 0 0;padding:0 0 0 24px;font-size:15.5px;line-height:1.8;color:#44403c">
      <li><b>Go to the map</b>  open StrayFeedingMap.</li>
      <li><b>Click an animal</b>  tap any pin to see its details.</li>
      <li><b>Click "I Fed" or "I Watered"</b>  log what you did.</li>
      <li><b>That's it!</b>  the pin updates so everyone knows.</li>
    </ol>
  </section>

  <section>
'''
    
    # Replace from old_start to old_end with new_sections
    content = content[:old_start] + new_sections + content[old_end:]
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Updated successfully!")