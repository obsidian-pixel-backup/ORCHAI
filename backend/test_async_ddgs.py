import asyncio
from duckduckgo_search import AsyncDDGS

async def search_web(query: str, max_results: int = 5):
    try:
        results = []
        async with AsyncDDGS() as ddgs:
            async for r in ddgs.text(query, max_results=max_results):
                results.append(r)
        return results
    except Exception as e:
        print(f"Error: {e}")
        return []

if __name__ == "__main__":
    results = asyncio.run(search_web("Cape Town weather today"))
    for r in results:
        print(r)
