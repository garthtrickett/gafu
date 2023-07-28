from pydantic import BaseModel
from langchain.chat_models import ChatOpenAI
from langchain.schema import AIMessage, HumanMessage, SystemMessage
import pprint
import pysrt
import sys
import time
import os
from dotenv import load_dotenv

load_dotenv()


openai_api_key = os.getenv("OPENAI_API_KEY")
# ffmpeg -i input.ass output.srt


def process_sub(subs_list, sub_num):
    pp = pprint.PrettyPrinter(indent=4)
    chat = ChatOpenAI(
    model="gpt-3.5-turbo",
    openai_api_key=openai_api_key,
    )

    subs_string = ", ".join(subs_list)
    print(subs_string)

    prompt_info = 'NOTE: absolutely no new lines (\n) in the output,  each value should be enclosed in double quotes Task: Tokenize - For each of the previous comma seperated sentences reply to me with no explanation only a single lined comma seperate string whose first values is “||”, followed by each token is 3 values "individual token","meaning(in the context of the sentence)","part of speech (english)”'

    prompt = prompt_info + subs_string

    messages = [
        SystemMessage(
            content="You are a helpful assistant that translates back and forth between English and Japanese."
        ),
        HumanMessage(content=prompt),
    ]
    chat_result = chat(messages)
    print(chat_result.content)


# Load the .srt file
subs = pysrt.open("../content/subs.srt")

sub_num = 0
temp_subs = []  # Temporary list to hold subtitles

# TIME START
start_time = time.time()

# Loop through each subtitle in the file
for sub in subs:
    # Add the text of the subtitle to the list
    temp_subs.append(sub.text)  # Add the subtitle to the temporary list

    if sub_num % 10 == 9:
        process_sub(temp_subs, sub_num)
        temp_subs = []  # Reset the temporary list

    sub_num = sub_num + 1

# Process any remaining subtitles if the total number is not a multiple of 10
if temp_subs:
    process_sub(temp_subs)

# TIME END
end_time = time.time()
elapsed_time = end_time - start_time
print(f"Elapsed time for processing 50 subtitles: {elapsed_time} seconds")
sys.exit()

# mecab = MeCab.Tagger("-Oyomi")
# furigana = mecab.parse(input.text).strip()
