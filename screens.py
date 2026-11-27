# Visual walkthrough: host screen (TV) + 3 phones. Saves screenshots to /home/claude/shots.
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = f"http://localhost:{os.environ.get('PORT', '3123')}"
OUT = "/home/claude/shots"
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        host_ctx = await b.new_context(viewport={"width": 1600, "height": 900})
        host = await host_ctx.new_page()
        await host.goto(f"{BASE}/host")
        await host.click("text=إنشاء غرفة جديدة")
        await host.wait_for_selector(".code")
        code = (await host.inner_text(".code")).strip()
        phones = []
        for name in ["براك", "لولوة", "أحمد"]:
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            ph = await ctx.new_page()
            await ph.goto(f"{BASE}/play?r={code}")
            await ph.fill("input.field:not(.code)", name)
            if name == "براك":
                await ph.screenshot(path=f"{OUT}/p1_join.png")
            await ph.click("text=دخول")
            phones.append(ph)
        await host.wait_for_timeout(500)
        await host.screenshot(path=f"{OUT}/h1_lobby.png")
        await phones[0].screenshot(path=f"{OUT}/p2_lobby.png")

        await host.click("text=ابدأ اللعبة")
        await host.wait_for_timeout(300)
        await host.screenshot(path=f"{OUT}/h2_ready.png")
        await host.keyboard.press("Space")
        await host.wait_for_timeout(700)
        # phone 0: type 3.2 then million-style multiplier depending on question; just type digits
        ph = phones[0]
        for k in ["8", "0", "0"]:
            await ph.click(f".pad button:nth-child({ {'8':8,'0':11}[k] })")
        await ph.click(".mults button:nth-child(1)")  # × ألف
        await ph.screenshot(path=f"{OUT}/p3_keypad.png")
        await ph.click("#submit")
        await host.wait_for_timeout(300)
        await ph.screenshot(path=f"{OUT}/p4_locked.png")
        # phone 1 answers with 2 digits + مليون
        await phones[1].click(".pad button:nth-child(1)")
        await phones[1].click(".pad button:nth-child(5)")
        await phones[1].click("#submit")
        await host.wait_for_timeout(400)
        await host.screenshot(path=f"{OUT}/h3_question.png")
        # phone 2 answers -> early reveal
        await phones[2].click(".pad button:nth-child(3)")
        await phones[2].click(".pad button:nth-child(11)")
        await phones[2].click("#submit")
        await host.wait_for_timeout(1800)
        await host.screenshot(path=f"{OUT}/h4_reveal.png")
        await phones[0].screenshot(path=f"{OUT}/p5_result.png")
        await host.keyboard.press("Space")
        await host.wait_for_timeout(800)
        await host.screenshot(path=f"{OUT}/h5_leaderboard.png")
        await phones[1].screenshot(path=f"{OUT}/p6_board.png")
        # fast-forward remaining 9 questions with host reveal
        for q in range(9):
            await host.keyboard.press("Space")  # next -> ready
            await host.wait_for_timeout(150)
            await host.keyboard.press("Space")  # go
            await host.wait_for_timeout(250)
            for i, ph in enumerate(phones):
                await ph.click(f".pad button:nth-child({i+2})")
                await ph.click("#submit")
            await host.wait_for_timeout(1300)
            await host.keyboard.press("Space")  # -> leaderboard/final
            await host.wait_for_timeout(250)
        await host.wait_for_timeout(1200)
        await host.screenshot(path=f"{OUT}/h6_final.png")
        await phones[0].screenshot(path=f"{OUT}/p7_final.png")
        errs = []
        await b.close()

asyncio.run(main())
print("done")
