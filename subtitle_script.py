import os
import re
import subprocess
import pysrt
import g4f
from gafu_lib import ichiran
from pysrt import SubRipItem, SubRipTime, SubRipFile


g4f.debug.logging = True  # Enable debug logging
g4f.debug.version_check = False  # Disable automatic version checking


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


def append_to_file(filename, sentence):
    with open(filename, "a") as f:
        f.write(sentence)


def process_sub(sub, base_filename):
    # 'index', 'start', 'end', 'position', 'text'
    cmd = ["docker", "exec", "-it", "ichiran-main-1", "ichiran-cli", "-i", sub.text]
    result = subprocess.run(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    kanji_with_furigana_array = ichiran.ichiran_output_to_bracket_furigana(result, sub)
    info_lines = get_info_lines(result)  # here while i'm not using bing results

    directory = os.path.dirname(base_filename)
    filename = os.path.join(directory, "ichiran_subs.txt")

    kanji_with_furigana_array_into_string = (
        "; ".join(['"' + word + '"' for word in kanji_with_furigana_array]) + "\n"
    )

    # premsg = "Translate "
    # postmsg = " reply only with translation wrapped in $$"

    # prompt = premsg + sub.text + postmsg

    # response = g4f.ChatCompletion.create(
    #     model=g4f.models.gpt_4_turbo,
    #     tone="Precise",
    #     provider=g4f.Provider.Bing,
    #     messages=[{"role": "user", "content": prompt}],
    # )

    # print(response)
    # match = re.search(r'\$\$(.*?)\$\$', response)

    # # Extract the matched substring
    # if match:
    #     translation = match.group(1) + "\n"
    # else:
    translation = "No translation \n"

    eng_filename = base_filename + '_eng.srt'
    txt_filename = base_filename + '.txt'

    if kanji_with_furigana_array_into_string:  # Check if the string is not empty
        print(kanji_with_furigana_array_into_string)
        append_to_file(txt_filename, kanji_with_furigana_array_into_string)

    # Write a counter to a file
    directory = os.path.dirname(filename)
    filename = os.path.join(directory, "ichiran_subs_counter.txt")

    # Open the file for writing
    with open(filename, "w") as f:
        # Write the value of sub_num to the file
        f.write(str(sub.index))

    # Create the new filename
    eng_filename = base_filename + '_eng.srt'
    eng_subs = pysrt.open(eng_filename, encoding='utf-8') if os.path.exists(eng_filename) else []

    # Create a new subtitle item
    start_time = SubRipTime(sub.start.hours, sub.start.minutes, sub.start.seconds, sub.start.milliseconds)
    start_time.milliseconds += 1
    end_time = SubRipTime(sub.end.hours, sub.end.minutes, sub.end.seconds, sub.end.milliseconds)
    new_sub = SubRipItem(index=len(eng_subs)+1, start=start_time, end=end_time, text=translation.strip())

    # Append the new subtitle item to the list
    eng_subs.append(new_sub)

    
    eng_subs = SubRipFile(items=eng_subs)
    # Save the updated .srt file
    eng_subs.save(eng_filename, encoding='utf-8')


def loop_through_subs(subs, filename):
    # Load the .srt file

    for sub in subs:
        # Add the text of the subtitle to the list
        # if sub_num % subs_per_process + 1 == subs_per_process:
        if 1:
            process_sub(sub, filename)


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

    # Get the base filename from the selected file
    base_filename = os.path.splitext(filename)[0]

    subs = pysrt.open(filename)

    dir_name = os.path.dirname(filename)

    # Concatenate the directory name with your filename
    sub_num_counter_filename = os.path.join(dir_name, "ichiran_subs_counter.txt")



    # Check if the file exists
    if os.path.exists(sub_num_counter_filename):
        # Open the file for reading
        with open(sub_num_counter_filename, "r") as f:
            # Read the contents of the file and convert it to an integer
            sub_index = int(f.read().strip())
            subs = subs[sub_index:]

    else:
        print(f"File not found: {sub_num_counter_filename}")

    loop_through_subs(subs, base_filename)  # Pass the base filename to the function


if __name__ == "__main__":
    main()
