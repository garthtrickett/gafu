import asyncio, json
import pysrt
import time
import subprocess
import sys

from gafu_lib import ichiran 
from EdgeGPT.EdgeGPT import Chatbot, ConversationStyle
from EdgeGPT.EdgeUtils import Query, Cookie
import browser_cookie3

def getCookies(url):
    browsers = [
        # browser_cookie3.chrome,
        browser_cookie3.chromium,
        # browser_cookie3.opera,
        # browser_cookie3.opera_gx,
        # browser_cookie3.brave,
        # browser_cookie3.edge,
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

def get_info_lines(result):
    lines = result.stdout.splitlines()
    results = []
    temp = []
    first_star = False
    for line in lines:
        if line.startswith('*'):
            first_star = True
            if temp:
                temp.pop()
                results.append(temp)
                temp = []
        elif first_star:
            temp.append(line)
    if temp:
        temp.pop()
        results.append(temp)
    return results

def append_to_file(file_name, sentence, meanings):
    with open(file_name, 'a') as f:
        f.write('; '.join(['"' + word + '"' for word in sentence]) + '\n')
        all_meanings = []
        for individual_tokens_meanings in meanings:        
            joined_meaning = "NEWLINE".join(individual_tokens_meanings)
            all_meanings.append(joined_meaning)
        f.write('|| '.join(all_meanings) + '\n')


async def process_sub(subs_list):
    ichiran_output = []
    bot = await Chatbot.create(cookies=getCookies('.bing.com'))
    for sub in subs_list:    
        # print(sub)
        cmd = ['docker', 'exec', '-it', 'ichiran-main-1', 'ichiran-cli', '-i', sub]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)        
        kanji_with_furigana_array = ichiran.ichiran_output_to_bracket_furigana(result,  sub)
        print(sub)
        print(kanji_with_furigana_array)

        
        info_lines = get_info_lines(result)
        file_name = "content/ichiran_subs.txt"
        append_to_file(file_name, kanji_with_furigana_array, info_lines)

        # prompt = kanji_with_furigana_csv + ' Input is a string containing  comma seperated values of tokenized japanese for a single japanese sentence. Output should take input and add a comma seperated value next to each japanese token containing the meaning of the word in the context of the sentence. Such that each sentence is now "token1", "meaning1", "token2", "meaning2" ...  NO EXPLANATION CSV ONLY'

        # start_time = time.time()

        # response = await bot.ask(prompt=prompt, conversation_style=ConversationStyle.precise, simplify_response=True)
        # print(response['text']) # Returns
        # end_time = time.time()
        # elapsed_time = end_time - start_time
        # print(f"Elapsed time for processing 1 subtitles: {elapsed_time} seconds")
    
    await bot.close()


async def loop_through_subs(subs):
    # Load the .srt file

    sub_num = 0
    temp_subs = []  # Temporary list to hold subtitles

    # TIME START
    start_time = time.time()

    # Loop through each subtitle in the file
    for sub in subs:
        # Add the text of the subtitle to the list
        temp_subs.append(sub.text)  # Add the subtitle to the temporary list

        if sub_num % 25 == 0:
            await process_sub(temp_subs)
            temp_subs = []  # Reset the temporary list

        sub_num = sub_num + 1

    # Process any remaining subtitles if the total number is not a multiple of 10
    if temp_subs:
        await process_sub(temp_subs)




async def main():
    subs = pysrt.open("content/subs.srt")
    await loop_through_subs(subs)

if __name__ == "__main__":
    asyncio.run(main())
