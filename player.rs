pub struct Player {
    pub name: String,
    pub hand: Vec<Card>,
}

impl Player {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            hand: Vec::new(),
        }
    }

    pub fn draw_card(&mut self, card: Card) {
        self.hand.push(card);
    }

    pub fn play_card(&mut self, index: usize) -> Option<Card> {
        if index < self.hand.len() {
            Some(self.hand.remove(index))
        } else {
            None
        }
    }
}
