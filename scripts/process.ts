import { info, error as logError } from "@tauri-apps/plugin-log"
import { generateNotes } from "../src/lib/ai-service"
import { loadApiKey } from "../src/lib/storage"

const transcript = `So many of us are working with remote teams, international clients, and everything in between. So effective online meetings are more important than ever. To get the most out of our meetings and to truly follow up on what you've discussed, we need a powerful but easy way to organize notes. I'm Nick and today we're partnering with Granola to show how you can use their AI powered notepad to transcribe any meeting, generate organized notes, and get detailed analysis of your meetings. Granola doesn't care which meeting app you're using because it simply transcribes the audio on your computer during a call, which is great for me because I don't always get to decide which meeting platform I'm using. I usually just accept invitations and go with whatever the client wants. And this is a great time for a Microsoft Teams user like me to be working with Granola because they now support signin and linking with a Microsoft 365 account. So, I can use my Teams or Outlook calendar as my primary system and still use Granola whenever I have a meeting in Zoom or any other system. You can go to granola.ai to download and install the app. The first thing you do when you run Granola is sign in using your Google Workspace account or your Microsoft 365 account. If you have both, you should sign in with the account that you use most often. I set up Granola with my Microsoft account. Granola connects to your calendar and always shows the meetings you have coming up over the next 3 days. And every item on the list represents a Granola note. Of course, there are notes from meetings I've had in the past, but even the upcoming events listed here are note pages just waiting to be activated. Sometimes I like to click an upcoming meeting from my calendar to open the note, then start writing some thoughts or agenda items well before it's time for that meeting. This helps me do some prep work and reminds me of topics I need to bring up during the meeting. Back on that main page, yo... (line truncated to 2000 chars)

async function main() {
  const key = await loadApiKey()
  info("Model: deepseek-v4-pro")
  info("API key configured:", !!key)

  const result = await generateNotes("", transcript, undefined)
  info(result)
}

main().catch(logError)
