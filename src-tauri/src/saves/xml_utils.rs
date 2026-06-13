pub fn get_tag_value<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start_idx = xml.find(&start_tag)?;
    let end_idx = xml.find(&end_tag)?;
    if start_idx < end_idx {
        Some(&xml[start_idx + start_tag.len()..end_idx])
    } else {
        None
    }
}

pub fn extract_tag_i32(xml: &str, tag: &str) -> i32 {
    get_tag_value(xml, tag)
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0)
}

pub fn extract_tag_u64(xml: &str, tag: &str) -> u64 {
    get_tag_value(xml, tag)
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
}

pub fn extract_tag_string(xml: &str, tag: &str) -> String {
    get_tag_value(xml, tag)
        .map(|v| v.to_string())
        .unwrap_or_else(|| "".to_string())
}

pub fn replace_first_tag_value(xml: &str, tag: &str, new_value: &str) -> Result<String, String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    let start_idx = xml
        .find(&start_tag)
        .ok_or_else(|| format!("Tag <{}> not found", tag))?;
    let value_start = start_idx + start_tag.len();
    let end_rel = xml[value_start..]
        .find(&end_tag)
        .ok_or_else(|| format!("Closing tag </{}> not found", tag))?;
    let value_end = value_start + end_rel;

    let mut updated = String::with_capacity(xml.len() + new_value.len());
    updated.push_str(&xml[..value_start]);
    updated.push_str(new_value);
    updated.push_str(&xml[value_end..]);
    Ok(updated)
}

pub fn get_direct_child_tag_value<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open_tag = format!("<{}", tag);
    let close_tag = format!("</{}>", tag);
    let mut depth = 0usize;
    let mut pos = 0usize;
    let bytes = xml.as_bytes();

    while pos < xml.len() {
        let Some(rel_start) = xml[pos..].find('<') else {
            break;
        };
        let start = pos + rel_start;
        let Some(rel_end) = xml[start..].find('>') else {
            break;
        };
        let end = start + rel_end;
        let token = &xml[start..=end];

        if token.starts_with("</") {
            depth = depth.saturating_sub(1);
        } else {
            if depth == 1 && token.starts_with(&open_tag) {
                let value_start = end + 1;
                let value_end_rel = xml[value_start..].find(&close_tag)?;
                let value_end = value_start + value_end_rel;
                if !xml[value_start..value_end].contains('<') {
                    return Some(xml[value_start..value_end].trim());
                }
            }

            let self_closing = bytes.get(end.saturating_sub(1)).is_some_and(|b| *b == b'/');
            if !self_closing && !token.starts_with("<?") && !token.starts_with("<!") {
                depth += 1;
            }
        }

        pos = end + 1;
    }

    None
}

pub fn extract_direct_child_blocks<'a>(xml: &'a str, child_tag: &str) -> Vec<&'a str> {
    let open_tag = format!("<{}", child_tag);
    let close_tag = format!("</{}>", child_tag);
    let mut blocks = Vec::new();
    let mut depth = 0usize;
    let mut pos = 0usize;
    let mut current_start: Option<usize> = None;
    let bytes = xml.as_bytes();

    while pos < xml.len() {
        let Some(rel_start) = xml[pos..].find('<') else {
            break;
        };
        let start = pos + rel_start;
        let Some(rel_end) = xml[start..].find('>') else {
            break;
        };
        let end = start + rel_end;
        let token = &xml[start..=end];

        if token.starts_with("</") {
            if depth == 2 && token == close_tag {
                if let Some(block_start) = current_start.take() {
                    blocks.push(&xml[block_start..start + close_tag.len()]);
                }
            }
            depth = depth.saturating_sub(1);
        } else {
            let self_closing = bytes.get(end.saturating_sub(1)).is_some_and(|b| *b == b'/');
            if depth == 1 && token.starts_with(&open_tag) {
                current_start = Some(start);
                if self_closing {
                    blocks.push(&xml[start..=end]);
                    current_start = None;
                }
            }

            if !self_closing && !token.starts_with("<?") && !token.starts_with("<!") {
                depth += 1;
            }
        }

        pos = end + 1;
    }

    blocks
}
