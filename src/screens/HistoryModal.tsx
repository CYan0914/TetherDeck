import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BridgeSession } from '../types';

export interface HistoryModalProps {
  visible: boolean;
  loading: boolean;
  sessions: BridgeSession[];
  onClose: () => void;
  onPick: (session: BridgeSession) => void;
  demo?: boolean;
}

function fmtTime(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' min ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' hr ago';
  if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + ' d ago';
  const d = new Date(ts);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function HistoryModal({ visible, loading, sessions, onClose, onPick, demo }: HistoryModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Session history</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>Done</Text>
            </Pressable>
          </View>
          {demo ? <Text style={styles.demoHint}>Demo data — sample sessions only</Text> : null}

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#8b94a3" />
            </View>
          ) : sessions.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.empty}>No past sessions yet</Text>
            </View>
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => onPick(item)}>
                  <Text numberOfLines={2} style={styles.rowTitle}>
                    {item.title || item.firstMsg || '(Untitled session)'}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text numberOfLines={1} style={styles.metaProject}>
                      {item.project}
                    </Text>
                    <Text style={styles.metaTime}>{fmtTime(item.lastAt)}</Text>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '78%',
    backgroundColor: '#161a20',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a303a',
  },
  title: { color: '#f2f5f9', fontSize: 17, fontWeight: '700' },
  close: { color: '#3178c6', fontSize: 16, fontWeight: '600' },
  demoHint: { color: '#8b94a3', fontSize: 12, paddingHorizontal: 20, paddingTop: 10 },
  center: { paddingVertical: 40, alignItems: 'center' },
  empty: { color: '#5c6470', fontSize: 14 },
  list: { paddingHorizontal: 12, paddingTop: 8 },
  row: { paddingHorizontal: 8, paddingVertical: 12, borderRadius: 10 },
  rowTitle: { color: '#e6ebf2', fontSize: 15, fontWeight: '600', lineHeight: 20 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  metaProject: { color: '#5c6470', fontSize: 12, flex: 1, marginRight: 12 },
  metaTime: { color: '#5c6470', fontSize: 12 },
});
