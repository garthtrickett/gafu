import asyncio, json
import pysubs2
import pysrt
import time
import subprocess
import sys
import re

from gafu_lib import ichiran

import g4f


# ffmpeg -i subs.ass subs.srt

subs_per_process = 1

def get_info_lines(result):
    lines = result.stdout.splitlines()
    results = []
    temp = []
    first_star = False
    for line in lines:
        if line.startswith("*"):
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


def append_to_file(filename, sentence, meanings, translation):
    with open(filename, "a") as f:
        f.write(sentence)
        f.write(meanings)
        f.write(translation)


def process_sub(sub, filename):
    print(sub)
    cmd = ["docker", "exec", "-it", "ichiran-main-1", "ichiran-cli", "-i", sub.text]
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    kanji_with_furigana_array = ichiran.ichiran_output_to_bracket_furigana(result, sub)
    kanji_with_furigana_string = ", ".join(
        f'"{item}"' for item in kanji_with_furigana_array
    )
    info_lines = get_info_lines(result)  # here while i'm not using bing results

    prompt = (
        "Translate each of the tokens the following japanese comma seperated sentence one by one but in the context of the sentence. Make the output a numbered list. Only output one list."
        + kanji_with_furigana_string
    )

    prompt_two = (
        "Translate the following sentence into English. Return only the sentence no explanation. "
        + sub.text
    )
    # if sub.index > 15:
    # sys.exit()

    try:
        response = g4f.ChatCompletion.create(
            model=g4f.Model.gpt_4,
            messages=[{"role": "user", "content": prompt}],
            provider=g4f.Provider.ChatgptAi,
        )

        match = re.search(r"(?<=\n\n)(\d+\. .+\n)+", response)
        if match:
            # Split the matched string into lines and remove the numbers at the beginning of each line
            gpt_info_lines = [
                re.sub(r"^\d+\. ", "", line)
                for line in match.group().split("\n")
                if line
            ]

        else:
            print("No numbered list found")
            gpt_info_lines = []

        # translation = g4f.ChatCompletion.create(model=g4f.Model.gpt_4, messages=[
        # {"role": "user", "content": prompt_two}], provider=g4f.Provider.ChatgptAi)

    except Exception as e:
        print(f"An error occurred: {e}")
        # Run a command using subprocess
        p = subprocess.Popen(
            ["/usr/bin/node", "../../../Applications/vpn_ip_swapper/vpn_ip_swapper.js"],
            stdout=subprocess.PIPE,
        )
        out = p.stdout.read()
        print(out)
        gpt_info_lines = []
        translation = "No Translation"

    directory = os.path.dirname(filename)
    filename = os.path.join(directory, "ichiran_subs.txt")

    kanji_with_furigana_array_into_string = (
        "; ".join(['"' + word + '"' for word in kanji_with_furigana_array]) + "\n"
    )

    if len(kanji_with_furigana_array) == len(gpt_info_lines):
        info_lines_string = "|| ".join(gpt_info_lines) + "\n"
    else:
        all_meanings = []
        for individual_tokens_meanings in info_lines:
            joined_meaning = "NEWLINE".join(individual_tokens_meanings)
            all_meanings.append(joined_meaning)
        info_lines_string = "|| ".join(all_meanings) + "\n"

    # translation = translation + '\n'

    translation = "No Translation \n"

    append_to_file(
        filename, kanji_with_furigana_array_into_string, info_lines_string, translation
    )

    # Write a counter to a file
    directory = os.path.dirname(filename)
    filename = os.path.join(directory, "ichiran_subs_counter.txt")

    # Open the file for writing
    with open(filename, "w") as f:
        # Write the value of sub_num to the file
        f.write(str(sub.index))


def loop_through_subs(subs, filename):
    # Load the .srt file

    temp_subs = []  # Temporary list to hold subtitles

    # TIME START
    start_time = time.time()

    # Loop through each subtitle in the file
    for sub in subs:
        # Add the text of the subtitle to the list
        # if sub_num % subs_per_process + 1 == subs_per_process:
        if 1:
            process_sub(sub, filename)


import os
import subprocess
import pysubs2


def main(sub_num=None, filename=None):
    try:
        env = os.environ.copy()
        env["FZF_DEFAULT_COMMAND"] = "find ~/files/jp/anime -type f"
        filename = subprocess.check_output(["fzf"], env=env).decode().strip()
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
        with open(sub_num_counter_filename, "r") as f:
            # Read the contents of the file and convert it to an integer
            sub_index = int(f.read().strip())
            subs = subs[sub_index:]

    else:
        print(f"File not found: {sub_num_counter_filename}")

    loop_through_subs(subs, filename)


if __name__ == "__main__":
    main()
