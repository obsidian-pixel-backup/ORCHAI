import asyncio
from ddgs import DDGS
from bs4 import BeautifulSoup
import nodriver as uc
import httpx
import ssl

async def search_web(query: str, max_results: int = 5) -> list[dict]:
    """
    Search DuckDuckGo for a query and return a list of dictionaries with title, href, and body.
    """
    try:
        def _search():
            # httpx inside duckduckgo_search can fail in threads without an event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                with DDGS() as ddgs:
                    return list(ddgs.text(query, max_results=max_results))
            finally:
                loop.close()
                
        raw_results = await asyncio.to_thread(_search)
        
        results = []
        for r in raw_results:
            results.append({
                "title": r.get("title", ""),
                "href": r.get("href", ""),
                "body": r.get("body", "")
            })
        if not results:
            print("DDGS returned no results. Falling back to Google via nodriver...")
            try:
                import urllib.parse
                browser = await uc.start(headless=True)
                page = await browser.get(f"https://www.google.com/search?q={urllib.parse.quote(query)}")
                await asyncio.sleep(4)
                html = await page.get_content()
                soup = BeautifulSoup(html, "html.parser")
                for g in soup.find_all("div", class_="g"):
                    a_tag = g.find("a")
                    title_tag = g.find("h3")
                    if a_tag and title_tag:
                        link = a_tag.get("href")
                        title = title_tag.text
                        if link and title and link.startswith("http"):
                            results.append({
                                "title": title,
                                "href": link,
                                "body": ""
                            })
                            if len(results) >= max_results:
                                break
            except Exception as ex:
                print(f"Fallback search failed: {ex}")
            finally:
                try:
                    if 'browser' in locals() and browser:
                        browser.stop()
                except:
                    pass

        return results
    except Exception as e:
        print(f"Error during DuckDuckGo search: {e}")
        return []

async def scrape_page(url: str) -> str:
    """
    Scrape a webpage. First tries httpx for speed and simplicity. 
    If blocked or JS required, falls back to nodriver to bypass anti-bot protections.
    """
    def clean_html(html_content: str) -> str:
        soup = BeautifulSoup(html_content, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "iframe"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        return "\n".join(chunk for chunk in chunks if chunk)

    # 1. Try httpx first
    try:
        async with httpx.AsyncClient(verify=False, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}) as client:
            resp = await client.get(url, timeout=10.0, follow_redirects=True)
            if resp.status_code == 200:
                html_content = resp.text
                if "Just a moment" not in html_content and "cf-browser-verification" not in html_content:
                    cleaned = clean_html(html_content)
                    if cleaned.strip():
                        return cleaned
    except Exception as e:
        print(f"httpx failed for {url}: {e}")

    # 2. Fallback to nodriver
    browser = None
    try:
        browser = await uc.start(headless=True, browser_args=["--ignore-certificate-errors"])
        page = await browser.get(url)
        
        # Wait for the network to idle and JS/Cloudflare to resolve
        for _ in range(3):
            await asyncio.sleep(3) 
            html_content = await page.get_content()
            if "Just a moment" not in html_content and "cf-browser-verification" not in html_content:
                break
        
        cleaned_text = clean_html(html_content)
        
        if not cleaned_text.strip():
            return f"Error: Scraped page is empty after stripping tags."
            
        return cleaned_text
    except Exception as e:
        print(f"Error in scrape_page for {url}: {e}")
        return f"Error scraping page: {str(e)}"
    finally:
        # Close the browser session securely to avoid memory leaks
        if browser is not None:
            browser.stop()

async def research_topic(query: str) -> str:
    """
    Master function that orchestrates the search and concurrent scraping.
    """
    print(f"[*] Starting research for: '{query}'")
    
    # 1. Get top URLs
    search_results = await search_web(query, max_results=3)
    if not search_results:
        return "No results found from DuckDuckGo."
    
    # 2. Setup concurrency limit (e.g., 2 browsers at a time)
    semaphore = asyncio.Semaphore(2)
    
    async def safe_scrape(result: dict) -> str:
        url = result["href"]
        async with semaphore:
            print(f"[*] Scraping URL: {url}")
            try:
                # Apply a timeout to prevent hanging indefinitely on broken or stalled websites
                scraped_text = await asyncio.wait_for(scrape_page(url), timeout=45.0)
                
                # If scraping yielded nothing or failed, use the DuckDuckGo snippet
                if not scraped_text.strip():
                    print(f"[!] Scrape returned empty for {url}. Falling back to snippet.")
                    scraped_text = result["body"]
                    
            except asyncio.TimeoutError:
                print(f"[!] Timeout scraping {url} (possibly stuck on CAPTCHA). Falling back to snippet.")
                scraped_text = result["body"]
            except Exception as e:
                print(f"[!] Error processing {url}: {e}. Falling back to snippet.")
                scraped_text = result["body"]
                
            return (
                f"Source: {url}\n"
                f"Title: {result['title']}\n\n"
                f"Content: {scraped_text}\n\n"
                f"---"
            )

    # 3. Concurrently scrape the pages
    tasks = [safe_scrape(r) for r in search_results]
    scraped_pages = await asyncio.gather(*tasks)
    
    # 4. Aggregate and return
    return "\n\n".join(scraped_pages)

if __name__ == "__main__":
    async def main():
        query = "What are the core principles of Agentic AI workflows?"
        result_report = await research_topic(query)
        print("\n=== FINAL RESEARCH REPORT ===\n")
        print(result_report)
        
    # Run the test execution
    asyncio.run(main())
