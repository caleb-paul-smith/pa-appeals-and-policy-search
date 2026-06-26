import os
import json
import time
import requests as http_requests
import gradio as gr

# Configuration from environment
VS_INDEX = os.environ.get("VS_INDEX_NAME", "tws_ro_region5.rcd.pa_appeals_chunks_vs_index")
DATABRICKS_HOST = os.environ.get("DATABRICKS_HOST", "https://adb-5672234203219303.3.azuredatabricks.net").rstrip("/")
PROCESSOR_NOTEBOOK = "/Users/0492734585@fema.dhs.gov/pa-appeals-and-policy-search/PA Appeals PDF Incremental Processor"
CHUNKS_TABLE = "tws_ro_region5.rcd.pa_appeals_chunks_vs"


def query_vector_index(token: str, query_text: str, num_results: int = 10):
    """Query the vector search index using the REST API directly with user token."""
    url = f"{DATABRICKS_HOST}/api/2.0/vector-search/indexes/{VS_INDEX}/query"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "columns": ["chunk_id", "filename", "page_number", "chunk_type", "chunk_text"],
        "query_text": query_text,
        "num_results": num_results,
    }
    resp = http_requests.post(url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()


def search_appeals(query: str, num_results: int = 10, request: gr.Request = None):
    """Search PA Second Appeals using vector similarity."""
    if not query.strip():
        return "Please enter a search query."

    try:
        user_token = request.headers.get("X-Forwarded-Access-Token") if request else None
        if not user_token:
            return "Error: No user authentication token found. Please refresh the page."

        data = query_vector_index(user_token, query, int(num_results))

        manifest = data.get("manifest", {})
        result = data.get("result", {})
        if not result or not result.get("data_array"):
            return "No results found."

        # Build formatted output
        output_parts = []
        columns = [col["name"] for col in manifest.get("columns", [])]

        for i, row in enumerate(result["data_array"], 1):
            row_dict = dict(zip(columns, row))
            filename = row_dict.get("filename", "Unknown")
            page = row_dict.get("page_number", "?")
            score = row_dict.get("score", "N/A")
            text = str(row_dict.get("chunk_text", ""))[:800]

            # Clean up filename for display
            display_name = str(filename).replace(".pdf", "")

            score_str = f"{float(score):.3f}" if score != "N/A" else "N/A"
            output_parts.append(
                f"### Result {i} (relevance: {score_str})\n"
                f"**Document:** {display_name}\n"
                f"**Page:** {page}\n\n"
                f"{text}\n\n---\n"
            )

        return "\n".join(output_parts) if output_parts else "No results found."

    except http_requests.exceptions.HTTPError as e:
        return f"Search error: {e.response.status_code} - {e.response.text[:200]}"
    except Exception as e:
        return f"Search error: {str(e)}"


# --- Admin Panel Functions ---

def get_index_stats(request: gr.Request = None):
    """Get stats about the current index."""
    user_token = request.headers.get("X-Forwarded-Access-Token") if request else None
    if not user_token:
        return "Error: Not authenticated."
    headers = {"Authorization": f"Bearer {user_token}"}
    try:
        idx_url = f"{DATABRICKS_HOST}/api/2.0/vector-search/indexes/{VS_INDEX}"
        resp = http_requests.get(idx_url, headers=headers, timeout=15)
        resp.raise_for_status()
        idx_data = resp.json()
        status = idx_data.get("status", {})
        indexed_rows = status.get("indexed_row_count", "Unknown")
        ready = status.get("ready", False)
        message = status.get("message", "")
        return (
            f"### Index Status\n\n"
            f"| Metric | Value |\n"
            f"| --- | --- |\n"
            f"| **Indexed Chunks** | {indexed_rows:,} |\n"
            f"| **Index Ready** | {'Yes' if ready else 'No'} |\n"
            f"| **Status** | {message[:100]} |\n"
            f"| **Index Name** | `{VS_INDEX}` |\n"
        )
    except Exception as e:
        return f"Error fetching stats: {str(e)}"


def trigger_refresh(request: gr.Request = None):
    """Trigger the incremental processor notebook as a one-time job run."""
    user_token = request.headers.get("X-Forwarded-Access-Token") if request else None
    if not user_token:
        return "Error: Not authenticated.", ""
    headers = {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}
    payload = {
        "run_name": "PA Appeals Manual Refresh",
        "tasks": [{
            "task_key": "process_pdfs",
            "notebook_task": {
                "notebook_path": PROCESSOR_NOTEBOOK,
                "source": "WORKSPACE",
            },
            "environment_key": "Default",
        }],
        "environments": [{
            "environment_key": "Default",
            "spec": {"client": "2", "dependencies": ["pypdf"]},
        }],
    }
    try:
        resp = http_requests.post(
            f"{DATABRICKS_HOST}/api/2.1/jobs/runs/submit",
            headers=headers, json=payload, timeout=30
        )
        resp.raise_for_status()
        run_id = resp.json().get("run_id", "unknown")
        return (
            f"**Refresh triggered!** Run ID: `{run_id}`\n\n"
            f"The notebook is processing new/modified PDFs. "
            f"Click 'Check Run Status' to monitor progress.",
            str(run_id)
        )
    except http_requests.exceptions.HTTPError as e:
        return f"Error: {e.response.status_code} - {e.response.text[:300]}", ""
    except Exception as e:
        return f"Error: {str(e)}", ""


def check_run_status(run_id: str, request: gr.Request = None):
    """Check the status of a refresh run."""
    user_token = request.headers.get("X-Forwarded-Access-Token") if request else None
    if not user_token:
        return "Error: Not authenticated."
    if not run_id.strip():
        return "No run ID provided. Trigger a refresh first."
    headers = {"Authorization": f"Bearer {user_token}"}
    try:
        url = f"{DATABRICKS_HOST}/api/2.1/jobs/runs/get?run_id={run_id.strip()}"
        resp = http_requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        state = data.get("state", {})
        life_cycle = state.get("life_cycle_state", "UNKNOWN")
        result_state = state.get("result_state", "")
        import datetime
        start_time = data.get("start_time", 0)
        end_time = data.get("end_time", 0)
        start_str = datetime.datetime.fromtimestamp(start_time / 1000).strftime("%Y-%m-%d %H:%M:%S") if start_time else "N/A"
        end_str = datetime.datetime.fromtimestamp(end_time / 1000).strftime("%Y-%m-%d %H:%M:%S") if end_time else "Still running..."
        status_label = {"TERMINATED": ("Completed" if result_state == "SUCCESS" else "Failed"),
                        "RUNNING": "Running...", "PENDING": "Pending..."}.get(life_cycle, life_cycle)
        output = (
            f"### Run Status: {status_label}\n\n"
            f"| Field | Value |\n| --- | --- |\n"
            f"| **Run ID** | `{run_id.strip()}` |\n"
            f"| **State** | {life_cycle} |\n"
            f"| **Result** | {result_state or 'In progress'} |\n"
            f"| **Started** | {start_str} |\n"
            f"| **Ended** | {end_str} |\n"
        )
        if life_cycle == "TERMINATED" and result_state != "SUCCESS":
            output += f"\n**Error:** {state.get('state_message', 'No details.')[:500]}\n"
        elif life_cycle == "TERMINATED" and result_state == "SUCCESS":
            output += "\n*Refresh complete. Click 'Refresh Stats' to see updated index counts.*"
        return output
    except Exception as e:
        return f"Error checking status: {str(e)}"


# --- Build Gradio Interface ---

with gr.Blocks(
    title="PA Appeals & Policy Search",
    theme=gr.themes.Soft(),
) as app:

    with gr.Tabs():
        with gr.Tab("Search"):
            gr.Markdown(
                "# FEMA PA Second Appeals Search\n"
                "Search across 2,900+ PA Second Appeal decision documents (1990-2026) "
                "using semantic similarity.\n\n"
                "Enter a question or keywords about eligibility, cost reasonableness, "
                "procurement, timelines, categories of work, or specific disaster numbers."
            )
            with gr.Row():
                query_input = gr.Textbox(
                    label="Search Query",
                    placeholder="e.g., debris removal eligibility on federal-aid routes",
                    lines=2, scale=4,
                )
                num_results_input = gr.Slider(
                    minimum=3, maximum=25, value=10, step=1,
                    label="Number of Results", scale=1,
                )
            search_btn = gr.Button("Search", variant="primary")
            results_output = gr.Markdown(label="Results")
            search_btn.click(fn=search_appeals, inputs=[query_input, num_results_input], outputs=results_output)
            query_input.submit(fn=search_appeals, inputs=[query_input, num_results_input], outputs=results_output)
            gr.Markdown(
                "---\n*Data source: PA Second Appeals volume "
                "(`tws_ro_region5.rcd.pa_second_appeals`). "
                "Powered by Databricks Vector Search with GTE-Large embeddings.*"
            )

        with gr.Tab("Admin"):
            gr.Markdown("# Index Administration\nManage the PA Appeals search index.")
            stats_output = gr.Markdown(value="*Click 'Refresh Stats' to load current index status.*")
            stats_btn = gr.Button("Refresh Stats", variant="secondary")
            stats_btn.click(fn=get_index_stats, inputs=[], outputs=stats_output)

            gr.Markdown("---\n### Manual Refresh\nScan for new/modified PDFs, parse them, and update the search index.")
            refresh_btn = gr.Button("Refresh Index (Process New PDFs)", variant="primary")
            refresh_output = gr.Markdown()
            run_id_state = gr.State(value="")
            refresh_btn.click(fn=trigger_refresh, inputs=[], outputs=[refresh_output, run_id_state])

            gr.Markdown("---\n### Check Run Status")
            with gr.Row():
                run_id_input = gr.Textbox(label="Run ID", placeholder="Auto-populated after refresh", scale=3)
                status_btn = gr.Button("Check Run Status", scale=1)
            run_status_output = gr.Markdown()
            refresh_btn.click(fn=lambda rid: rid, inputs=[run_id_state], outputs=[run_id_input])
            status_btn.click(fn=check_run_status, inputs=[run_id_input], outputs=run_status_output)

if __name__ == "__main__":
    app.launch(server_name="0.0.0.0", server_port=8000)
