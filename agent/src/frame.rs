//! Frame layer: `u32 length | u8 kind | payload`.
//!
//! The control channel carries one JSON-RPC object per frame; data frames carry a stream id and a
//! sequence number before the bytes. Frames are bounded by `MAX_FRAME`; a violation closes the
//! session instead of trying to resynchronize a byte stream.

use std::io::{self, ErrorKind, Read, Write};

pub const CONTROL: u8 = 1;
pub const DATA: u8 = 2;

pub const MAX_FRAME: usize = 16 * 1024 * 1024;
pub const MAX_CONTROL: usize = 1024 * 1024;
pub const MAX_DATA: usize = 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct Frame {
    pub kind: u8,
    pub payload: Vec<u8>,
}

/// Read one frame. `Ok(None)` means the peer closed cleanly between frames.
pub fn read_frame<R: Read>(reader: &mut R) -> io::Result<Option<Frame>> {
    let mut length = [0u8; 4];
    match read_exact_or_eof(reader, &mut length)? {
        false => return Ok(None),
        true => {}
    }
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut buffer = vec![0u8; length];
    reader.read_exact(&mut buffer)?;
    let kind = buffer[0];
    if kind != CONTROL && kind != DATA {
        return Err(io::Error::new(ErrorKind::InvalidData, "unknown frame kind"));
    }
    Ok(Some(Frame {
        kind,
        payload: buffer[1..].to_vec(),
    }))
}

fn read_exact_or_eof<R: Read>(reader: &mut R, buffer: &mut [u8]) -> io::Result<bool> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => {
                if filled == 0 {
                    return Ok(false);
                }
                return Err(io::Error::new(
                    ErrorKind::UnexpectedEof,
                    "truncated frame header",
                ));
            }
            Ok(n) => filled += n,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(true)
}

pub fn write_frame<W: Write>(writer: &mut W, kind: u8, payload: &[u8]) -> io::Result<()> {
    let limit = if kind == CONTROL {
        MAX_CONTROL
    } else {
        MAX_DATA
    };
    if payload.len() > limit {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "frame payload too large",
        ));
    }
    let length = (payload.len() + 1) as u32;
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(&[kind])?;
    writer.write_all(payload)?;
    writer.flush()
}

pub fn write_control<W: Write>(writer: &mut W, json: &str) -> io::Result<()> {
    write_frame(writer, CONTROL, json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_roundtrip() {
        let mut buffer = Vec::new();
        write_control(&mut buffer, "{\"jsonrpc\":\"2.0\"}").unwrap();
        let mut cursor = io::Cursor::new(buffer);
        let frame = read_frame(&mut cursor).unwrap().unwrap();
        assert_eq!(frame.kind, CONTROL);
        assert_eq!(frame.payload, b"{\"jsonrpc\":\"2.0\"}");
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn data_roundtrip() {
        let mut buffer = Vec::new();
        write_frame(
            &mut buffer,
            DATA,
            &[0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, b'x'],
        )
        .unwrap();
        let mut cursor = io::Cursor::new(buffer);
        let frame = read_frame(&mut cursor).unwrap().unwrap();
        assert_eq!(frame.kind, DATA);
        assert_eq!(frame.payload[12], b'x');
    }

    #[test]
    fn rejects_zero_length_and_unknown_kind() {
        let mut zero = io::Cursor::new(vec![0, 0, 0, 0]);
        assert!(read_frame(&mut zero).is_err());
        let mut unknown = io::Cursor::new(vec![0, 0, 0, 2, 9, b'x']);
        assert!(read_frame(&mut unknown).is_err());
    }

    #[test]
    fn rejects_oversize_control() {
        let mut buffer = Vec::new();
        let payload = vec![b'x'; MAX_CONTROL + 1];
        assert!(write_frame(&mut buffer, CONTROL, &payload).is_err());
    }
}
