use super::require_reader;

pub struct XnbPayloadReader<'a> {
    pub data: &'a [u8],
    pub pos: usize,
}

impl<'a> XnbPayloadReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    pub fn read_type_readers(&mut self) -> Result<Vec<String>, String> {
        let reader_count = self.read_7bit_usize()?;
        let mut readers = Vec::with_capacity(reader_count);
        for _ in 0..reader_count {
            readers.push(self.read_string()?);
            let _version = self.read_i32()?;
        }
        let _shared_resource_count = self.read_7bit_usize()?;
        Ok(readers)
    }

    pub fn read_i32(&mut self) -> Result<i32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(i32::from_le_bytes(bytes))
    }

    pub fn read_f32(&mut self) -> Result<f32, String> {
        let bytes = self.read_array::<4>()?;
        Ok(f32::from_le_bytes(bytes))
    }

    pub fn read_f64(&mut self) -> Result<f64, String> {
        let bytes = self.read_array::<8>()?;
        Ok(f64::from_le_bytes(bytes))
    }

    pub fn read_bool(&mut self) -> Result<bool, String> {
        match self.read_u8()? {
            0 => Ok(false),
            1 => Ok(true),
            value => Err(format!("Invalid bool byte {}", value)),
        }
    }

    pub fn read_7bit_usize(&mut self) -> Result<usize, String> {
        let mut count = 0usize;
        let mut shift = 0;

        loop {
            if shift >= 35 {
                return Err("Invalid 7-bit encoded integer".to_string());
            }
            let byte = self.read_u8()?;
            count |= ((byte & 0x7F) as usize) << shift;
            if byte & 0x80 == 0 {
                return Ok(count);
            }
            shift += 7;
        }
    }

    pub fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_7bit_usize()?;
        if len == 0 {
            return Ok(String::new());
        }
        let bytes = self.read_bytes(len)?;
        String::from_utf8(bytes.to_vec()).map_err(|e| format!("Invalid UTF-8 string: {}", e))
    }

    pub fn read_object_string(&mut self, type_readers: &[String]) -> Result<String, String> {
        let reader_index = self.read_7bit_usize()?;
        if reader_index == 0 {
            return Ok(String::new());
        }
        require_reader(type_readers, reader_index, "StringReader")?;
        self.read_string()
    }

    pub fn read_object_string_any(&mut self) -> Result<String, String> {
        if self.read_7bit_usize()? == 0 {
            return Ok(String::new());
        }
        self.read_string()
    }

    pub fn read_bytes(&mut self, len: usize) -> Result<&'a [u8], String> {
        if self.pos + len > self.data.len() {
            return Err(format!(
                "Unexpected end of XNB payload at byte {}, wanted {} more bytes",
                self.pos, len
            ));
        }
        let start = self.pos;
        self.pos += len;
        Ok(&self.data[start..self.pos])
    }

    pub fn read_u8(&mut self) -> Result<u8, String> {
        let bytes = self.read_bytes(1)?;
        Ok(bytes[0])
    }

    pub fn read_array<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let bytes = self.read_bytes(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(bytes);
        Ok(out)
    }
}
