//! 内存 TUN：用通道模拟一块网卡，供测试与无网卡环境下的联调使用。
//!
//! 引擎侧持有 [`MemTun`]；"操作系统"一侧持有 [`MemTunHost`]：
//! `inject` 相当于操作系统向网卡写入要发出的包，`next` 读出引擎写回网卡的包。

use std::io;
use std::time::Duration;

use tokio::sync::{mpsc, Mutex};

use crate::tun::{BoxFuture, TunIo};

/// 引擎侧的内存网卡
pub struct MemTun {
    from_host: Mutex<mpsc::Receiver<Vec<u8>>>,
    to_host: mpsc::Sender<Vec<u8>>,
}

/// "操作系统"侧的句柄
pub struct MemTunHost {
    inject_tx: mpsc::Sender<Vec<u8>>,
    out_rx: mpsc::Receiver<Vec<u8>>,
}

/// 创建一对内存网卡端点；`capacity` 为两个方向各自的队列长度
pub fn mem_tun(capacity: usize) -> (MemTun, MemTunHost) {
    let (inject_tx, inject_rx) = mpsc::channel(capacity);
    let (out_tx, out_rx) = mpsc::channel(capacity);
    (
        MemTun {
            from_host: Mutex::new(inject_rx),
            to_host: out_tx,
        },
        MemTunHost { inject_tx, out_rx },
    )
}

impl MemTunHost {
    /// 模拟操作系统向网卡写入一个待发送的包
    pub async fn inject(&self, pkt: &[u8]) -> io::Result<()> {
        self.inject_tx
            .send(pkt.to_vec())
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "内存网卡已关闭"))
    }

    /// 读出引擎写回网卡的下一个包；超时返回 `None`
    pub async fn next(&mut self, timeout: Duration) -> Option<Vec<u8>> {
        tokio::time::timeout(timeout, self.out_rx.recv())
            .await
            .ok()
            .flatten()
    }
}

impl TunIo for MemTun {
    fn recv<'a>(&'a self, buf: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            let mut rx = self.from_host.lock().await;
            let pkt = rx
                .recv()
                .await
                .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "内存网卡已关闭"))?;
            if pkt.len() > buf.len() {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "接收缓冲区太小"));
            }
            buf[..pkt.len()].copy_from_slice(&pkt);
            Ok(pkt.len())
        })
    }

    fn send<'a>(&'a self, pkt: &'a [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            self.to_host
                .send(pkt.to_vec())
                .await
                .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "内存网卡已关闭"))?;
            Ok(pkt.len())
        })
    }
}
