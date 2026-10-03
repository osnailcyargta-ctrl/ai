# STS language reference (from github.com/osnailcyargta-ctrl/STS-programing)
## What this is

STS — Stupid Tree Systems — is a small programming language. The whole
language (lexer, compiler, bytecode VM, objects, collisions, timers) is written in
C and compiled to WebAssembly. The page you are looking at only draws pixels and
buttons; it never interprets your code.

## The tree

A program is one tree. The trunk is main and runs first. Every
root under it is another file, numbered in the order it runs. Click a node to
open its code, hit + at the bottom of the roots to add one, right-click a
root node (or the × on its tab) to delete it.
Jump out of order any time:

goto #3        // run root 3 now, then carry on from here
return         // end this root early

## Drawing

on {x} {y} draw {shape} {size...} [color "#rrggbb"]. {id}

on 20 10 draw circle 30. apesi
on 5 5   draw rect 120 40 color "#8fd14f". kotak
on 60 90 draw square 40. blok
on 10 10 draw triangle 50 60. atap
on 0 0   draw line 200 140 color "#fff". garis
on 24 20 draw text "hello" 18 color "#b9e389". judul
on 30 40 draw image "kucing.png" 64 48. gambar
on 30 40 draw video "clip.mp4" 160 90. klip

Each slot after on and draw takes one value — a
number, a variable or a call. Maths goes in braces, so that
on 0 -40 ... stays the point (0, -40):

on {x + 8} {y * 2} draw circle {r}. bola

Shapes: rect · square · circle ·
ellipse · triangle · line · text ·
image · video. x and y are the
top-left corner; for a circle the one size is its diameter. Braces
{ } are optional grouping, handy for expressions.
Drawing to an id that already exists updates it — that is how you animate.
Upload a picture, sound or video with the Upload button and then use its file
name in the code — in quotes. Quotes are what keep a name like
"level2.png" in one piece; without them the dot is read as the id
separator and the name falls apart, so STS stops and says so.

## Variables

var coin = 0
coin = coin + 1
coin += 1
/var"coin" + 1        // the long form works everywhere too

if /var"coin" > /var"harga":
    /var"cpc" + 1
else:
    show.popup("you poor dumb shit")

Values are numbers, text, true/false and nil.
"coin: " + coin glues text and numbers together.

## Control flow

if a > b:
    ...
elif a == b:
    ...
else:
    ...

while i Blocks are indentation based, like Python. // starts a comment.

## def

def tambah(a, b):
    return a + b

var total = tambah(2, 3)

## Collisions

setup coll {x} {y} [{w} {h}] {mode}. {id}
setup coll /id"apesi" {mode}. {id}

- solid — nothing else can move into it. move() is blocked by it.
- detect(...) — fires once when something enters the area.
- click(...) / hover(...) — fires on the mouse.

setup coll 20 10 solid. asep
setup coll 20 10 40 40 detect(goto #3). zona
setup coll /id"apesi" solid. badanApesi

Bound to an /id"...", the area follows that object for as long as it
lives — no coordinates needed. The mode may be written before the target too
(setup coll click /id"apesi" (…)), but only one mode per collider:
coll click … detect(…) is refused, because a collider cannot be both.

## What goes inside an action

The brackets of detect(…), click(…), hover(…)
and timer every N (…) hold real code, not just a call — assignments,
if, goto, anything. Separate several with ;:

setup coll /id"apesi" click(/var"asp" + 1). tombol
setup coll 20 10 40 40 detect(nyawa = nyawa - 1; goto #3). duri
timer every 1 (waktu = waktu + 1; set("jam", "text", waktu)). jam

## Events

onclick /id"apesi" check:
    coin = coin + cpc

onhover /id"tombol":
    set("tombol", "color", "#93cc5f")

oncollide /id"peluru":
    goto #4

check is optional sugar. Handlers can cut into a running
forever loop — they run, then the loop picks up where it was.

## Popups

show.popup("you poor dumb shit")            // one OK button
var nama = show.anspopup("siapa nama lu")   // typed answer becomes a value

Both park the program until the person answers.

## Time

wait 1.5                        // park this root for 1.5 seconds

stopwatch start. sw             // counts up
stopwatch stop. sw
stopwatch reset. sw

countdown 10 (goto #2). bom     // counts down, then does the thing
countdown stop. bom
countdown start. bom

timer every 0.5 (tembak()). gun // repeats forever
timer clear. gun

/time"sw"                       // read any of them

## Chance

rand()             // 0 … 1
rand(5, 10)        // anywhere between 5 and 10
randint(1, 6)      // a whole number, like a dice
random()           // same as rand()
choose("a", "b", "c")   // one of them, picked at random
chance(0.3)        // true 30% of the time

Every ▶ reseeds, so the same program rolls different numbers each run.

## Builtins

log(x)  print(x)  say(x)          background("#101a0c")  clear()
choose(a, b, ...)  chance(p)      random()
move(id, dx, dy)                  setpos(id, x, y)
set(id, prop, value)              get(id, prop)
hide(id)  showobj(id)  destroy(id)  exists(id)  touching(a, b)
key("left")  mousex()  mousey()  mousedown()  time()  timeof(name)
rand(a, b)  randint(a, b)  floor  ceil  round  abs  sqrt  sin  cos  pow  min  max
str(x)  num(x)  len(x)  sound("boom.mp3", 0.8)

Properties for set/get: x, y,
w, h, rot, alpha,
visible, color, text, src.

## Typing

A small popup follows the caret with up to four suggestions — snippets first,
then builtins, keywords, and the ids, variables, defs and uploaded file names your
own program already uses. Click one, or press Ctrl+Shift+1…4, or use ↑ ↓ and
Enter. Escape sends it away. That list is not written into the editor: it is read
out of the compiler itself, so it can never disagree with what STS accepts.
Typing " ( [ { gives you the
closing half straight away, with the caret in the middle. Typing the closing half
when it is already there just steps over it, and backspace between an empty pair
removes both.

## Projects and tabs

Up to four projects live side by side in the bar at the top — click to switch,
double-click to rename, × to delete. Each keeps its own tree, its own uploads and
its own stage size.
The × on a code tab closes the tab; the file stays on the tree, click its
node to open it again. To actually delete a root, right-click its node on the tree.

## Running it

▶ compiles every root and opens the stage — drag its title bar to move it, drag the
corner to resize. ⏸ freezes the VM mid-instruction, ⏹ throws the world away. The
Live tab shows every variable, timer and object while the program runs.

## Saving

Your project is kept in this browser. .sts downloads the whole thing —
every root and every uploaded file — as one plain text file you can hand to someone
else and re-open with Open.
