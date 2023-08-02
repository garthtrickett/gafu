import asyncio, json
import pysubs2
import pysrt
import time
import subprocess
import sys
import re

from gafu_lib import ichiran 
from bing_chat_api import start_chat, send_prompt, end_chat

import g4f


# ffmpeg -i subs.ass subs.srt

subs_per_process = 1




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


def append_to_file_gpt(filename, sentence, meanings):
    with open(filename, 'a') as f:
        f.write('; '.join(['"' + word + '"' for word in sentence]) + '\n')
        f.write('|| '.join(meanings) + '\n')

def append_to_file(filename, sentence, meanings):
    with open(filename, 'a') as f:
        f.write('; '.join(['"' + word + '"' for word in sentence]) + '\n')
        all_meanings = []
        for individual_tokens_meanings in meanings:        
            joined_meaning = "NEWLINE".join(individual_tokens_meanings)
            all_meanings.append(joined_meaning)
        f.write('|| '.join(all_meanings) + '\n')


def process_sub(subs_list, filename, sub_num):
    ichiran_tokens = []
    ichiran_meanings = []
    for sub in subs_list:    
        print(sub)
        cmd = ['docker', 'exec', '-it', 'ichiran-main-1', 'ichiran-cli', '-i', sub]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)        
        kanji_with_furigana_array = ichiran.ichiran_output_to_bracket_furigana(result,  sub)
        kanji_with_furigana_string = ', '.join(f'"{item}"' for item in kanji_with_furigana_array)
        info_lines = get_info_lines(result) # here while i'm not using bing results



    prompt = "Translate each of the tokens the following japanese comma seperated sentence one by one but in the context of the sentence. Make the output a numbered list. Only output one list." + kanji_with_furigana_string + "below the list put an english translation of the whole sentence in {} brackets"
    # prompt = ichiran_tokens_string + 'is a list of sentences as comma seperated values of tokenized japanese sentence with furigana. Please return another comma seperated list containing a translation of individual token in the context of the sentence its in (wrap each individual sentence in in 2 ||). Output format: ||"meaning1","meaning2", "meaning3"||"meaning1","meaning2"||. RETURN ONLY THE STRING NO EXPLANATION. LENGTH OF INPUT STRING MUST EQUAL LENGTH OF OUTPUT STRING. NEVER OUTPUT THE WHOLE TRANSLATED SENTENCE ALWAYS EACH TRANSLATED TOKEN ONE BY ONE'   


    try:
        response = g4f.ChatCompletion.create(model=g4f.Model.gpt_4, messages=[
        {"role": "user", "content": prompt}], provider=g4f.Provider.ChatgptAi)

        match = re.search(r'(?<=\n\n)(\d+\. .+\n)+', response)
        if match:
            # Split the matched string into lines and remove the numbers at the beginning of each line
            gpt_info_lines = [re.sub(r'^\d+\. ', '', line) for line in match.group().split('\n') if line]

        else:
            print('No numbered list found')
            gpt_info_lines = []

    except Exception as e:
        print(f'An error occurred: {e}')
        # Run a command using subprocess
        subprocess.run(['node', '../naughty_books/vpn_ip_swapper_gafu.js'])

    directory = os.path.dirname(filename)
    filename = os.path.join(directory, "ichiran_subs.txt")

    # if sub_num > 3:
        # sys.exit()

    if len(kanji_with_furigana_array) == len(gpt_info_lines):
        print(kanji_with_furigana_array)
        print(gpt_info_lines)

        append_to_file_gpt(filename, kanji_with_furigana_array, gpt_info_lines)
    else: 
        append_to_file(filename, kanji_with_furigana_array, info_lines)


    directory = os.path.dirname(filename)
    filename = os.path.join(directory, "ichiran_subs_counter.txt")

    # Open the file for writing
    with open(filename, 'w') as f:
        # Write the value of sub_num to the file
        f.write(str(sub_num))


def loop_through_subs(subs, filename):
    # Load the .srt file

    sub_num = 0
    temp_subs = []  # Temporary list to hold subtitles

    # TIME START
    start_time = time.time()


    # Loop through each subtitle in the file
    for sub in subs:
        # Add the text of the subtitle to the list
        temp_subs.append(sub.text)  # Add the subtitle to the temporary list
        # if sub_num % subs_per_process + 1 == subs_per_process:
        if 1:
            process_sub(temp_subs, filename, sub_num)

            temp_subs = []  # Reset the temporary list

        sub_num = sub_num + 1

    # Process any remaining subtitles if the total number is not a multiple of 10
    if temp_subs:
        process_sub(temp_subs, filename, sub_num)




import os
import subprocess
import pysubs2


def main(sub_num=None, filename=None):
    try:
        env = os.environ.copy()
        env['FZF_DEFAULT_COMMAND'] = 'find ~/files/jp/anime -type f'
        filename = subprocess.check_output(['fzf'], env=env).decode().strip()
    except subprocess.CalledProcessError:
        print("No file selected")
        return

    if not os.path.isfile(filename):
        print(f"{filename} is not a valid file")
        return

    directory = os.path.dirname(filename)


    subs = pysrt.open(filename)
    directory = os.path.dirname(filename)

    sub_num_counter_filename = os.path.join(directory, "ichiran_subs_counter.txt")

    # Check if the file exists
    if os.path.exists(sub_num_counter_filename):
        # Open the file for reading
        with open(sub_num_counter_filename, 'r') as f:
            # Read the contents of the file and convert it to an integer
            sub_num = int(f.read().strip())
    else:
        print(f'File not found: {sub_num_counter_filename}')

    if sub_num:
        subs = subs[sub_num+1:]
    print(sub_num)

    

    loop_through_subs(subs, filename)

if __name__ == "__main__":
    main()
