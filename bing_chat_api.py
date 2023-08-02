import asyncio, json
from EdgeGPT.EdgeGPT import Chatbot, ConversationStyle


# THIS IS LIMITED TO 30 CHATS PER SESSION and 300 per day so i need to try and get 10 tokenizations per chat so i can have 3000 subs per day

def getCookies(url):
    import browser_cookie3
    browsers = [
        # browser_cookie3.chrome,
        # browser_cookie3.chromium,
        # browser_cookie3.opera,
        # browser_cookie3.opera_gx,
        # browser_cookie3.brave,
        browser_cookie3.edge,
        # browser_cookie3.vivaldi,
        # browser_cookie3.firefox,
        # browser_cookie3.librewolf,
        # browser_cookie3.safari,
    ]
    for browser_fn in browsers:
        # if browser isn't installed browser_cookie3 raises exception
        # hence we need to ignore it and try to find the right one
        try:
            cookies = []
            cj = browser_fn(domain_name=url)
            for cookie in cj:
                cookies.append(cookie.__dict__)
            return cookies
        except:
            continue

def send_prompt(bot, prompt):
    response = asyncio.run(bot.ask(prompt=prompt, conversation_style=ConversationStyle.creative, simplify_response=True))
    return response['text']

def start_chat():
    bot = Chatbot(cookies=getCookies('.bing.com'))
    return bot

def end_chat(bot):
    asyncio.run(bot.close())

    

if __name__ == "__main__":
    count = 0
    while count < 30:
        prompt = "Hello World"
        asyncio.run(send_prompt(prompt))
        count = count + 1