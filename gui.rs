use raylib::prelude::*;
use std::collections::HashMap;
use crate::deck::Deck;  


/// Enum to track the current game state
enum GameState {
    StartScreen,
    Playing,
}

/// Struct to represent a card
type CardTextures = HashMap<String, Texture2D>;

/// Function to load all card images
fn load_card_textures(rl: &mut RaylibHandle, thread: &RaylibThread) -> CardTextures {
    let suits = ["hearts", "diamonds", "clubs", "spades", "red", "black"];
    let values = [
        "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace", "joker"
    ];
    // let jokers = ["red_joker", "black_joker"];
    
    let mut textures = HashMap::new();
    
    for &suit in &suits {
        for &value in &values {
            let filename = format!("assets/{}_of_{}.png", value, suit);
            if let Ok(texture) = rl.load_texture(&thread, &filename) {
                textures.insert(format!("{}_{}", value, suit), texture);
            }
        }
    }
    
    // for &joker in &jokers {
    //     let filename = format!("assets/{}.png", joker);
    //     if let Ok(texture) = rl.load_texture(&thread, &filename) {
    //         textures.insert(joker.to_string(), texture);
    //     }
    // }
    
    textures
}

/// Function to initialize and run the game window
pub fn run_game_window() {
    let (mut rl, thread) = raylib::init()
        .size(800, 600)
        .title("Card Game")
        .build();

    let mut game_state = GameState::StartScreen;
    let card_textures = load_card_textures(&mut rl, &thread);
    let deck_texture = rl.load_texture(&thread, "assets/deck.png").unwrap();
    
    let mut deck = Deck::new();
    deck.shuffle();
    let mut drawn_cards = Vec::new();

    while !rl.window_should_close() {
        let mouse_pos = rl.get_mouse_position();
        let mouse_clicked = rl.is_mouse_button_pressed(MouseButton::MOUSE_BUTTON_LEFT);

        let mut d = rl.begin_drawing(&thread);
        d.clear_background(Color::RAYWHITE);

        match game_state {
            GameState::StartScreen => {
                d.draw_text("Welcome to the Card Game!", 190, 150, 25, Color::DARKGRAY);

                let button_x = 300;
                let button_y = 300;
                let button_width = 200;
                let button_height = 50;

                let is_hovered = mouse_pos.x > button_x as f32
                    && mouse_pos.x < (button_x + button_width) as f32
                    && mouse_pos.y > button_y as f32
                    && mouse_pos.y < (button_y + button_height) as f32;

                let button_color = if is_hovered { Color::LIGHTGRAY } else { Color::GRAY };

                d.draw_rectangle(button_x, button_y, button_width, button_height, button_color);
                d.draw_text("Start Game", button_x + 40, button_y + 15, 20, Color::WHITE);

                if is_hovered && mouse_clicked {
                    game_state = GameState::Playing;
                }
            }
            GameState::Playing => {
                d.draw_text("Game in Progress...", 250, 50, 25, Color::DARKGRAY);
                
                // Draw deck
                let deck_x = 50;
                let deck_y = 250;
                let deck_width = 100;
                let deck_height = 150;

                let is_deck_hovered = mouse_pos.x > deck_x as f32
                && mouse_pos.x < (deck_x + deck_width) as f32
                && mouse_pos.y > deck_y as f32
                && mouse_pos.y < (deck_y + deck_height) as f32;

                d.draw_texture_pro(
                    &deck_texture,
                    Rectangle { x: 0.0, y: 0.0, width: deck_texture.width() as f32, height: deck_texture.height() as f32 },
                    Rectangle { x: deck_x as f32, y: deck_y as f32, width: deck_width as f32, height: deck_height as f32 },
                    Vector2::new(0.0, 0.0),
                    0.0,
                    if is_deck_hovered { Color::LIGHTGRAY } else { Color::GRAY },
                );

                // Check if deck is clicked
                let is_deck_clicked = mouse_clicked &&
                    mouse_pos.x > deck_x as f32 && mouse_pos.x < (deck_x + deck_width) as f32 &&
                    mouse_pos.y > deck_y as f32 && mouse_pos.y < (deck_y + deck_height) as f32;
                
                if is_deck_clicked {
                    if let Some(card) = deck.draw() {
                        drawn_cards.push(card);
                    }
                }

                // Render drawn cards
                let screen_width = d.get_screen_width();
                let screen_height = d.get_screen_height();
                let card_width = (screen_width as f32 * 0.1) as i32;
                let card_height = (screen_height as f32 * 0.2) as i32;
                

                let mut hovered_index: Option<usize> = None;

                // First pass: Find the topmost hovered card
                for (i, card) in drawn_cards.iter().enumerate() {
                    if let Some(texture) = card_textures.get(&card.name().to_string()) {
                        let mut x = 50 + (i as i32) * (card_width + 20);
                        let mut y = screen_height - card_height - 50;
                        
                        if i > 6 {
                            let row = (i as i32) / 7;
                            let x_offset = if row % 2 == 1 { 50 } else { 0 }; // Shift every other row
                            x = 50 + ((i as i32) % 7) * (card_width + 20) + x_offset;
                            y = screen_height - card_height - 50 + 20 * row;
                        }
                        

                        let is_card_hovered = mouse_pos.x > x as f32
                            && mouse_pos.x < (x + card_width) as f32
                            && mouse_pos.y > y as f32
                            && mouse_pos.y < (y + card_height) as f32;
                        
                        if is_card_hovered {
                            hovered_index = Some(i); // Store the index of the topmost hovered card
                        }
                    }
                }

                // Second pass: Draw all cards, but highlight only the topmost hovered one
                for (i, card) in drawn_cards.iter().enumerate() {
                    if let Some(texture) = card_textures.get(&card.name().to_string()) {
                        let mut x = 50 + (i as i32) * (card_width + 20);
                        let mut y = screen_height - card_height - 50;
                        
                        if i > 6 {
                            let row = (i as i32) / 7;
                            let x_offset = if row % 2 == 1 { 50 } else { 0 }; // Shift every other row
                            x = 50 + ((i as i32) % 7) * (card_width + 20) + x_offset;
                            y = screen_height - card_height - 50 + 20 * row;
                        }

                        let is_topmost_hovered = Some(i) == hovered_index;

                        d.draw_texture_pro(
                            texture,
                            Rectangle { x: 0.0, y: 0.0, width: texture.width() as f32, height: texture.height() as f32 },
                            Rectangle { x: x as f32, y: y as f32, width: card_width as f32, height: card_height as f32 },
                            Vector2::new(0.0, 0.0),
                            0.0,
                            if is_topmost_hovered { Color::LIGHTGRAY } else { Color::WHITE },
                        );
                    }
                }
            }
        }
    }
}