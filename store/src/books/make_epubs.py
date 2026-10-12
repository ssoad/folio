"""Builds the sample library for the store screenshots: public-domain
classics as EPUB 3 files, each with the cover from cover.html.

Usage: python3 store/src/books/make_epubs.py  (after build.sh rendered the
covers into store/build/covers/)
"""

import html
import os
import uuid
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "..", "..", "build")

PRIDE_CH1 = [
    "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
    "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.",
    "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
    "Mr. Bennet replied that he had not.",
    "“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”",
    "Mr. Bennet made no answer.",
    "“Do not you want to know who has taken it?” cried his wife impatiently.",
    "“You want to tell me, and I have no objection to hearing it.”",
    "This was invitation enough.",
    "“Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week.”",
    "“What is his name?”",
    "“Bingley.”",
    "“Is he married or single?”",
    "“Oh! single, my dear, to be sure! A single man of large fortune; four or five thousand a year. What a fine thing for our girls!”",
    "“How so? how can it affect them?”",
    "“My dear Mr. Bennet,” replied his wife, “how can you be so tiresome! You must know that I am thinking of his marrying one of them.”",
    "“Is that his design in settling here?”",
    "“Design! nonsense, how can you talk so! But it is very likely that he may fall in love with one of them, and therefore you must visit him as soon as he comes.”",
    "“I see no occasion for that. You and the girls may go, or you may send them by themselves, which perhaps will be still better; for as you are as handsome as any of them, Mr. Bingley might like you the best of the party.”",
    "“My dear, you flatter me. I certainly have had my share of beauty, but I do not pretend to be any thing extraordinary now. When a woman has five grown up daughters, she ought to give over thinking of her own beauty.”",
    "“In such cases, a woman has not often much beauty to think of.”",
    "“But, my dear, you must indeed go and see Mr. Bingley when he comes into the neighbourhood.”",
    "“It is more than I engage for, I assure you.”",
    "“But consider your daughters. Only think what an establishment it would be for one of them. Sir William and Lady Lucas are determined to go, merely on that account; for in general, you know, they visit no new comers. Indeed you must go, for it will be impossible for us to visit him, if you do not.”",
    "“You are over scrupulous surely. I dare say Mr. Bingley will be very glad to see you; and I will send a few lines by you to assure him of my hearty consent to his marrying whichever he chuses of the girls; though I must throw in a good word for my little Lizzy.”",
    "“I desire you will do no such thing. Lizzy is not a bit better than the others; and I am sure she is not half so handsome as Jane, nor half so good humoured as Lydia. But you are always giving her the preference.”",
    "“They have none of them much to recommend them,” replied he; “they are all silly and ignorant like other girls; but Lizzy has something more of quickness than her sisters.”",
    "“Mr. Bennet, how can you abuse your own children in such a way? You take delight in vexing me. You have no compassion on my poor nerves.”",
    "“You mistake me, my dear. I have a high respect for your nerves. They are my old friends. I have heard you mention them with consideration these twenty years at least.”",
    "“Ah! you do not know what I suffer.”",
    "“But I hope you will get over it, and live to see many young men of four thousand a year come into the neighbourhood.”",
    "“It will be no use to us, if twenty such should come, since you will not visit them.”",
    "“Depend upon it, my dear, that when there are twenty, I will visit them all.”",
    "Mr. Bennet was so odd a mixture of quick parts, sarcastic humour, reserve, and caprice, that the experience of three and twenty years had been insufficient to make his wife understand his character. Her mind was less difficult to develope. She was a woman of mean understanding, little information, and uncertain temper. When she was discontented she fancied herself nervous. The business of her life was to get her daughters married; its solace was visiting and news.",
]

PRIDE_CH2 = [
    "Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go; and till the evening after the visit was paid, she had no knowledge of it.",
    "It was then disclosed in the following manner. Observing his second daughter employed in trimming a hat, he suddenly addressed her with,",
    "“I hope Mr. Bingley will like it, Lizzy.”",
    "“We are not in a way to know what Mr. Bingley likes,” said her mother resentfully, “since we are not to visit.”",
    "“But you forget, mama,” said Elizabeth, “that we shall meet him at the assemblies, and that Mrs. Long has promised to introduce him.”",
]

# key, title, author, cover index, chapters: [(heading, paragraphs)]
BOOKS = [
    ("pride", "Pride and Prejudice", "Jane Austen", 0, [("Chapter 1", PRIDE_CH1), ("Chapter 2", PRIDE_CH2)]),
    ("moby", "Moby-Dick", "Herman Melville", 1, [("Chapter 1. Loomings", [
        "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.",
        "It is a way I have of driving off the spleen and regulating the circulation. Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; then, I account it high time to get to sea as soon as I can.",
    ])]),
    ("alice", "Alice’s Adventures in Wonderland", "Lewis Carroll", 2, [("Chapter I. Down the Rabbit-Hole", [
        "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice “without pictures or conversations?”",
        "So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.",
    ])]),
    ("frankenstein", "Frankenstein", "Mary Shelley", 3, [("Letter 1", [
        "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings. I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence in the success of my undertaking.",
    ])]),
    ("sherlock", "The Adventures of Sherlock Holmes", "Arthur Conan Doyle", 4, [("A Scandal in Bohemia", [
        "To Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex.",
    ])]),
    ("timemachine", "The Time Machine", "H. G. Wells", 5, [("Chapter I", [
        "The Time Traveller (for so it will be convenient to speak of him) was expounding a recondite matter to us. His pale grey eyes shone and twinkled, and his usually pale face was flushed and animated.",
    ])]),
    ("littlewomen", "Little Women", "Louisa May Alcott", 6, [("Chapter One. Playing Pilgrims", [
        "“Christmas won’t be Christmas without any presents,” grumbled Jo, lying on the rug.",
        "“It’s so dreadful to be poor!” sighed Meg, looking down at her old dress.",
    ])]),
    ("dracula", "Dracula", "Bram Stoker", 7, [("Chapter I. Jonathan Harker’s Journal", [
        "3 May. Bistritz.—Left Munich at 8:35 P.M., on 1st May, arriving at Vienna early next morning; should have arrived at 6:46, but train was an hour late.",
    ])]),
    ("gatsby", "The Great Gatsby", "F. Scott Fitzgerald", 8, [("Chapter I", [
        "In my younger and more vulnerable years my father gave me some advice that I’ve been turning over in my mind ever since.",
        "“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven’t had the advantages that you’ve had.”",
    ])]),
]


def chapter_xhtml(heading, paragraphs):
    body = "\n".join(f"<p>{html.escape(p, quote=False)}</p>" for p in paragraphs)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>{html.escape(heading)}</title></head>
<body>
<h2>{html.escape(heading)}</h2>
{body}
</body>
</html>
"""


def build(key, title, author, cover_index, chapters):
    book_id = "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, "folio-sample-" + key))
    with open(os.path.join(BUILD, "covers", f"{cover_index}.png"), "rb") as f:
        cover = f.read()
    items = "\n".join(
        f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>'
        for i in range(len(chapters))
    )
    spine = "\n".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
    nav_items = "\n".join(
        f'<li><a href="c{i}.xhtml">{html.escape(h)}</a></li>' for i, (h, _) in enumerate(chapters)
    )
    ncx_points = "\n".join(
        f'<navPoint id="n{i}" playOrder="{i + 1}"><navLabel><text>{html.escape(h)}</text></navLabel><content src="c{i}.xhtml"/></navPoint>'
        for i, (h, _) in enumerate(chapters)
    )
    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">{book_id}</dc:identifier>
    <dc:title>{html.escape(title)}</dc:title>
    <dc:creator>{html.escape(author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:rights>Public domain</dc:rights>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta name="cover" content="cover"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    {items}
  </manifest>
  <spine toc="ncx">
    {spine}
  </spine>
</package>
"""
    nav = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>{nav_items}</ol></nav></body>
</html>
"""
    ncx = f"""<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="{book_id}"/></head>
<docTitle><text>{html.escape(title)}</text></docTitle>
<navMap>{ncx_points}</navMap>
</ncx>
"""
    container = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
"""
    out = os.path.join(BUILD, "books", f"{title.replace('/', '-')}.epub")
    with zipfile.ZipFile(out, "w") as z:
        # The mimetype entry comes first and uncompressed
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/toc.ncx", ncx, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/cover.png", cover, compress_type=zipfile.ZIP_STORED)
        for i, (heading, paragraphs) in enumerate(chapters):
            z.writestr(f"OEBPS/c{i}.xhtml", chapter_xhtml(heading, paragraphs), compress_type=zipfile.ZIP_DEFLATED)
    return out


if __name__ == "__main__":
    os.makedirs(os.path.join(BUILD, "books"), exist_ok=True)
    for book in BOOKS:
        print(build(*book))
